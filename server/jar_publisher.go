package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"reflect"
	"strings"
	"time"
)

func stageJarDesired(state *jarConnectionState, desired jarKandy) bool {
	desired = cloneJarKandy(desired)
	if state.Pending != nil {
		if reflect.DeepEqual(state.Pending.Kandy, desired) {
			changed := state.Desired != nil
			state.Desired = nil
			return changed
		}
		if state.Desired != nil && reflect.DeepEqual(*state.Desired, desired) {
			return false
		}
		state.Desired = &desired
		return true
	}
	if state.Published != nil && reflect.DeepEqual(*state.Published, desired) {
		changed := state.Desired != nil
		state.Desired = nil
		return changed
	}
	if state.AckedRevision < 0 || state.AckedRevision >= jarMaxSafeRevision {
		return false
	}
	state.Pending = &jarPendingSnapshot{Revision: state.AckedRevision + 1, Kandy: desired}
	state.Desired = nil
	return true
}

func acknowledgeJarPending(state *jarConnectionState, revision int64) error {
	if state.Pending == nil || revision <= 0 || state.Pending.Revision != revision {
		return fmt.Errorf("publish acknowledgement does not match pending revision")
	}
	published := cloneJarKandy(state.Pending.Kandy)
	state.AckedRevision = revision
	state.Published = &published
	state.Pending = nil
	desired := state.Desired
	state.Desired = nil
	if desired != nil && !reflect.DeepEqual(*desired, published) {
		if revision >= jarMaxSafeRevision {
			return fmt.Errorf("publisher revision exhausted")
		}
		next := cloneJarKandy(*desired)
		state.Pending = &jarPendingSnapshot{Revision: revision + 1, Kandy: next}
	}
	return nil
}

func cloneJarKandy(value jarKandy) jarKandy {
	ancestors := make([]jarAncestor, len(value.Ancestors))
	copy(ancestors, value.Ancestors)
	value.Ancestors = ancestors
	return value
}

func (p *plugin) queueJarForLedger(ledger *ledger) {
	if ledger == nil || ledger.transient {
		return
	}
	p.queueJarProjection(projectJarKandy(p.presentLedger(ledger, nil)))
}

func (p *plugin) queueJarProjection(projection jarKandy) {
	p.jarQueueMu.Lock()
	queued := cloneJarKandy(projection)
	p.jarQueued = &queued
	p.jarQueueMu.Unlock()
	p.signalJarPublisher()
}

func (p *plugin) signalJarPublisher() {
	p.jarWorkerOnce.Do(func() { go p.jarPublishLoop() })
	select {
	case p.jarSignal <- struct{}{}:
	default:
	}
}

func (p *plugin) jarPublishLoop() {
	ticker := time.NewTicker(jarMoodRefresh)
	defer ticker.Stop()
	for {
		select {
		case <-p.jarStop:
			return
		case <-p.jarSignal:
			if !p.waitJarDebounce() {
				return
			}
		case <-ticker.C:
			ledger, authoritative := p.ledgerSnapshot(context.Background())
			if !authoritative || ledger.transient {
				continue
			}
			p.jarQueueMu.Lock()
			projection := projectJarKandy(p.presentLedger(ledger, nil))
			p.jarQueued = &projection
			p.jarQueueMu.Unlock()
		}

		p.stageQueuedJarProjection(context.Background())
		for attempt := 0; attempt < jarRetryAttempts; attempt++ {
			retry := p.publishJarOnce(context.Background())
			if !retry {
				break
			}
			if attempt == jarRetryAttempts-1 || !p.waitJarRetry(attempt) {
				break
			}
			p.stageQueuedJarProjection(context.Background())
		}
	}
}

func (p *plugin) waitJarDebounce() bool {
	timer := time.NewTimer(jarDebounceDelay)
	defer timer.Stop()
	for {
		select {
		case <-p.jarStop:
			return false
		case <-p.jarSignal:
			if !timer.Stop() {
				select {
				case <-timer.C:
				default:
				}
			}
			timer.Reset(jarDebounceDelay)
		case <-timer.C:
			return true
		}
	}
}

func (p *plugin) waitJarRetry(attempt int) bool {
	delay := jarRetryBaseDelay << min(attempt, 5)
	if delay > jarRetryMaxDelay {
		delay = jarRetryMaxDelay
	}
	timer := time.NewTimer(delay)
	defer timer.Stop()
	for {
		select {
		case <-p.jarStop:
			return false
		case <-p.jarSignal:
			// Keep the latest projection queued, but preserve the backoff.
		case <-timer.C:
			return true
		}
	}
}

func (p *plugin) stageQueuedJarProjection(ctx context.Context) {
	p.jarQueueMu.Lock()
	queued := p.jarQueued
	p.jarQueued = nil
	p.jarQueueMu.Unlock()
	if queued == nil {
		return
	}
	host := p.Host()
	if host == nil {
		p.requeueJarProjection(*queued)
		return
	}
	p.jarMu.Lock()
	state, found, err := p.loadJarConnection(ctx, host)
	if err == nil && found && !state.Revoked && stageJarDesired(&state, *queued) {
		err = p.storeJarConnection(ctx, host, state)
	}
	p.jarMu.Unlock()
	if err != nil {
		p.requeueJarProjection(*queued)
	}
}

func (p *plugin) requeueJarProjection(projection jarKandy) {
	p.jarQueueMu.Lock()
	if p.jarQueued == nil {
		queued := cloneJarKandy(projection)
		p.jarQueued = &queued
	}
	p.jarQueueMu.Unlock()
	// A state read failure is not publish work. Keep the latest projection,
	// then wait for the next real activity signal or the periodic refresh;
	// self-signalling here turns a persistent Host outage into a busy loop.
}

// publishJarOnce delivers exactly one persisted outbox entry. Its boolean
// result says whether a bounded retry is worthwhile; every failure leaves the
// pending DTO and revision untouched, so repeating the call is idempotent.
func (p *plugin) publishJarOnce(ctx context.Context) bool {
	host := p.Host()
	if host == nil {
		return false
	}
	p.jarMu.Lock()
	defer p.jarMu.Unlock()
	state, found, err := p.loadJarConnection(ctx, host)
	if err != nil || !found || state.Revoked || state.Pending == nil {
		return false
	}
	credential, tokenFound, err := p.getJarSecret(ctx, host)
	if err != nil || !tokenFound || credential.Origin != state.Origin {
		return false
	}
	pending := jarPendingSnapshot{
		Revision: state.Pending.Revision,
		Kandy:    cloneJarKandy(state.Pending.Kandy),
	}
	retry, err := p.publishJarSnapshot(ctx, state, credential.Token, pending)
	if err != nil {
		return retry
	}
	if err := acknowledgeJarPending(&state, pending.Revision); err != nil {
		return false
	}
	if err := p.storeJarConnection(ctx, host, state); err != nil {
		// The server already accepted this exact revision. Retrying the
		// still-persisted outbox yields `unchanged`, then repeats the ack.
		return true
	}
	return state.Pending != nil
}

func (p *plugin) publishJarSnapshot(
	ctx context.Context,
	state jarConnectionState,
	token string,
	pending jarPendingSnapshot,
) (bool, error) {
	request := jarPublishRequest{
		ProtocolVersion: jarProtocolVersion,
		Revision:        pending.Revision,
		Kandy:           pending.Kandy,
	}
	raw, err := json.Marshal(request)
	if err != nil || len(raw) > jarSnapshotLimit {
		return false, fmt.Errorf("snapshot exceeds protocol limit")
	}
	var response jarPublishResponse
	status, err := p.doJarJSON(ctx, http.MethodPut, state.Origin,
		"/api/v1/installations/"+url.PathEscape(state.InstallationID)+"/snapshot",
		token, request, &response)
	if err != nil {
		return jarPublishRetryable(status), err
	}
	if status != http.StatusOK || response.ProtocolVersion != jarProtocolVersion ||
		!strings.EqualFold(response.InstallationID, state.InstallationID) ||
		response.Revision != pending.Revision ||
		(response.Status != "published" && response.Status != "unchanged") {
		return false, fmt.Errorf("invalid publish acknowledgement")
	}
	if _, err := time.Parse(time.RFC3339, response.ReceivedAt); err != nil {
		return false, fmt.Errorf("invalid publish timestamp")
	}
	return false, nil
}

func jarPublishRetryable(status int) bool {
	return status == 0 || status == http.StatusRequestTimeout || status == http.StatusTooManyRequests || status >= 500
}
