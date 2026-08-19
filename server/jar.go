package main

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"net/url"
	"reflect"
	"regexp"
	"strings"
	"time"

	"github.com/kandev/kandev/pkg/pluginsdk"
)

const (
	actionKeyJarConnect    = "jar.connect"
	actionKeyJarDisconnect = "jar.disconnect"
	actionKeyJarStatus     = "jar.status"

	configKeyJarOrigin = "jar_origin"
	defaultJarOrigin   = "https://jar.kandev.ai"

	jarConnectionStateKey     = "kandy_jar.connection"
	jarPublisherSecretKey     = "kandy_jar.publisher_token"
	jarConnectionStateVersion = 2
	jarConnectionSealVersion  = 1
	jarConnectionSealDomain   = "kandy-jar-connection:hmac:v1\n"
	jarPublisherSecretVersion = 1
	jarProtocolVersion        = 1
	jarHTTPTimeout            = 8 * time.Second
	jarResponseLimit          = 4 << 10
	jarSnapshotLimit          = 16 << 10
	jarMaxSafeRevision        = int64(1<<53 - 1)
	jarDebounceDelay          = 100 * time.Millisecond
	jarRetryBaseDelay         = time.Second
	jarRetryMaxDelay          = 30 * time.Second
	jarRetryAttempts          = 5
	jarMoodRefresh            = 15 * time.Minute
)

var (
	jarPairingCodePattern         = regexp.MustCompile(`^KJ-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$`)
	jarUUIDPattern                = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)
	jarPublisherPattern           = regexp.MustCompile(`^kjp_v1_[A-Za-z0-9_-]{43}$`)
	errJarConnectionCommitUnknown = errors.New("connection state commit outcome is unknown")
)

// jarKandy is the only creature shape that may cross the Kandy Jar boundary.
// Keep this DTO independent from kandyResponse: adding a local presentation
// field must never make it publishable by accident.
type jarKandy struct {
	Level           int           `json:"level"`
	Stage           int           `json:"stage"`
	Archetype       int           `json:"archetype"`
	Family          int           `json:"family"`
	Biome           int           `json:"biome"`
	LineageSeed     uint32        `json:"lineage_seed"`
	StageName       string        `json:"stage_name"`
	ProgressPct     float64       `json:"progress_pct"`
	AppearanceSeed  uint32        `json:"appearance_seed"`
	Mood            string        `json:"mood"`
	TemperamentBand string        `json:"temperament_band"`
	Scarred         bool          `json:"scarred"`
	Counterfeit     bool          `json:"counterfeit"`
	Generation      int           `json:"generation"`
	Ancestors       []jarAncestor `json:"ancestors"`
}

type jarAncestor struct {
	Level       int    `json:"level"`
	Archetype   int    `json:"archetype"`
	Family      int    `json:"family"`
	LineageSeed uint32 `json:"lineage_seed"`
	StageName   string `json:"stage_name"`
	Generation  int    `json:"generation"`
	Scarred     bool   `json:"scarred"`
}

type jarPendingSnapshot struct {
	Revision int64    `json:"revision"`
	Kandy    jarKandy `json:"kandy"`
}

type jarConnectionState struct {
	StateVersion    int                 `json:"state_version"`
	SealVersion     int                 `json:"seal_version"`
	Sig             string              `json:"sig"`
	ProtocolVersion int                 `json:"protocol_version"`
	InstallationID  string              `json:"installation_id"`
	Origin          string              `json:"origin"`
	OwnerActorID    string              `json:"owner_actor_id"`
	ConnectedAt     string              `json:"connected_at"`
	Revoked         bool                `json:"revoked,omitempty"`
	AckedRevision   int64               `json:"acked_revision,omitempty"`
	Published       *jarKandy           `json:"published,omitempty"`
	Pending         *jarPendingSnapshot `json:"pending,omitempty"`
	Desired         *jarKandy           `json:"desired,omitempty"`
}

type jarPublisherSecret struct {
	Version int    `json:"version"`
	Origin  string `json:"origin"`
	Token   string `json:"token"`
}

type jarConnectBody struct {
	PairingCode string `json:"pairing_code"`
}

type jarRedeemRequest struct {
	ProtocolVersion      int    `json:"protocol_version"`
	UserCode             string `json:"user_code"`
	PublisherTokenSHA256 string `json:"publisher_token_sha256"`
}

type jarRedeemResponse struct {
	ProtocolVersion int    `json:"protocol_version"`
	InstallationID  string `json:"installation_id"`
}

type jarPublishRequest struct {
	ProtocolVersion int      `json:"protocol_version"`
	Revision        int64    `json:"revision"`
	Kandy           jarKandy `json:"kandy"`
}

type jarPublishResponse struct {
	ProtocolVersion int    `json:"protocol_version"`
	InstallationID  string `json:"installation_id"`
	Revision        int64  `json:"revision"`
	Status          string `json:"status"`
	ReceivedAt      string `json:"received_at"`
}

type jarUpstreamResponseError struct {
	status      int
	contentType string
	body        []byte
}

func (e *jarUpstreamResponseError) Error() string {
	return fmt.Sprintf("upstream status %d", e.status)
}

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

func (p *plugin) HandleAction(ctx context.Context, req *pluginsdk.PluginActionRequest) (*pluginsdk.PluginActionResponse, error) {
	if req == nil {
		return jarActionError(http.StatusBadRequest, "invalid request"), nil
	}
	if req.Context.ActorID == "" {
		return jarActionError(http.StatusUnauthorized, "authentication required"), nil
	}
	if req.Context.WorkspaceID == "" {
		return jarActionError(http.StatusBadRequest, "workspace is required"), nil
	}
	switch req.ActionKey {
	case actionKeyJarConnect:
		return p.handleJarConnect(ctx, req)
	case actionKeyJarDisconnect:
		return p.handleJarDisconnect(ctx, req)
	case actionKeyJarStatus:
		return p.handleJarStatus(ctx, req)
	default:
		return jarActionError(http.StatusNotFound, "unknown action"), nil
	}
}

func (p *plugin) handleJarStatus(ctx context.Context, req *pluginsdk.PluginActionRequest) (*pluginsdk.PluginActionResponse, error) {
	host := p.Host()
	if host == nil {
		return jarActionError(http.StatusServiceUnavailable, "Kandev host is unavailable"), nil
	}
	p.jarMu.Lock()
	defer p.jarMu.Unlock()
	state, found, err := p.loadJarConnection(ctx, host)
	if err != nil {
		return jarActionError(http.StatusServiceUnavailable, "connection state is unavailable"), nil
	}
	if !found {
		return jarActionJSON(http.StatusOK, map[string]any{"connected": false}), nil
	}
	if state.OwnerActorID != req.Context.ActorID {
		return jarActionError(http.StatusForbidden, "Kandy Jar is owned by another user"), nil
	}
	pendingRevision := int64(0)
	if state.Pending != nil {
		pendingRevision = state.Pending.Revision
	}
	return jarActionJSON(http.StatusOK, map[string]any{
		"connected":           !state.Revoked,
		"installation_id":     state.InstallationID,
		"origin":              state.Origin,
		"acked_revision":      state.AckedRevision,
		"pending_revision":    pendingRevision,
		"publication_pending": state.Pending != nil,
	}), nil
}

func (p *plugin) handleJarDisconnect(ctx context.Context, req *pluginsdk.PluginActionRequest) (*pluginsdk.PluginActionResponse, error) {
	host := p.Host()
	if host == nil {
		return jarActionError(http.StatusServiceUnavailable, "Kandev host is unavailable"), nil
	}
	p.jarMu.Lock()
	defer p.jarMu.Unlock()
	state, found, err := p.loadJarConnection(ctx, host)
	if err != nil {
		return jarActionError(http.StatusServiceUnavailable, "connection state is unavailable"), nil
	}
	if !found {
		return jarActionJSON(http.StatusOK, map[string]any{"connected": false}), nil
	}
	if state.OwnerActorID != req.Context.ActorID {
		return jarActionError(http.StatusForbidden, "Kandy Jar is owned by another user"), nil
	}
	if !state.Revoked {
		credential, found, err := p.getJarSecret(ctx, host)
		if err != nil || !found || credential.Origin != state.Origin {
			return jarActionError(http.StatusServiceUnavailable, "publisher credential is unavailable"), nil
		}
		if err := p.revokeJarPublication(ctx, state.Origin, state.InstallationID, credential.Token); err != nil {
			return jarActionError(http.StatusBadGateway, "Kandy Jar could not be disconnected"), nil
		}
		// Persist the remote revocation before deleting the only credential.
		// A local cleanup failure can then be retried without attempting to
		// authenticate to an already-revoked publication.
		state.Revoked = true
		if err := p.storeJarConnection(ctx, host, state); err != nil {
			return jarActionError(http.StatusServiceUnavailable, "disconnect state could not be stored"), nil
		}
	}
	if err := p.deleteJarSecret(ctx, host); err != nil {
		return jarActionError(http.StatusServiceUnavailable, "publisher credential could not be deleted"), nil
	}
	if err := p.deleteJarConnection(ctx, host); err != nil {
		return jarActionError(http.StatusServiceUnavailable, "connection state could not be deleted"), nil
	}
	return jarActionJSON(http.StatusOK, map[string]any{"connected": false}), nil
}

func (p *plugin) handleJarConnect(ctx context.Context, req *pluginsdk.PluginActionRequest) (*pluginsdk.PluginActionResponse, error) {
	var input jarConnectBody
	if err := decodeStrictJSON(req.Body, &input); err != nil {
		return jarActionError(http.StatusBadRequest, "invalid pairing code"), nil
	}
	pairingCode, err := normalizeJarPairingCode(input.PairingCode)
	if err != nil {
		return jarActionError(http.StatusBadRequest, "invalid pairing code"), nil
	}
	host := p.Host()
	if host == nil {
		return jarActionError(http.StatusServiceUnavailable, "Kandev host is unavailable"), nil
	}

	p.jarMu.Lock()
	defer p.jarMu.Unlock()
	if existing, found, err := p.loadJarConnection(ctx, host); err != nil {
		return jarActionError(http.StatusServiceUnavailable, "connection state is unavailable"), nil
	} else if found {
		if existing.OwnerActorID != req.Context.ActorID {
			return jarActionError(http.StatusForbidden, "Kandy Jar is owned by another user"), nil
		}
		return jarActionError(http.StatusConflict, "Kandy Jar is already connected"), nil
	}
	ledger, authoritative := p.ledgerSnapshot(ctx)
	if !authoritative || ledger.transient {
		return jarActionError(http.StatusServiceUnavailable, "authoritative Kandy state is unavailable"), nil
	}

	origin, err := p.configuredJarOrigin(ctx, host)
	if err != nil {
		return jarActionError(http.StatusServiceUnavailable, "Kandy Jar origin is invalid"), nil
	}
	credential, credentialFound, err := p.getJarSecret(ctx, host)
	if err != nil {
		return jarActionError(http.StatusServiceUnavailable, "publisher credential is unavailable"), nil
	}
	tokenStored := credentialFound && credential.Origin == origin
	token := credential.Token
	var tokenHash string
	if tokenStored {
		tokenHash = jarPublisherTokenHash(token)
	} else {
		token, tokenHash, err = newJarPublisherToken()
		if err != nil {
			return jarActionError(http.StatusInternalServerError, "publisher credential generation failed"), nil
		}
	}
	installationID, status, err := p.redeemJarPairing(ctx, origin, pairingCode, tokenHash)
	if err != nil {
		return jarActionError(status, "pairing code is invalid, used, expired, or temporarily unavailable"), nil
	}
	if !tokenStored {
		if err := p.setJarSecret(ctx, host, origin, token); err != nil {
			p.revokeFailedJarConnect(ctx, origin, installationID, token)
			return jarActionError(http.StatusServiceUnavailable, "publisher credential could not be stored"), nil
		}
	}

	pending := &jarPendingSnapshot{
		Revision: 1,
		Kandy:    projectJarKandy(p.presentLedger(ledger, nil)),
	}
	state := jarConnectionState{
		StateVersion:    jarConnectionStateVersion,
		ProtocolVersion: jarProtocolVersion,
		InstallationID:  installationID,
		Origin:          origin,
		OwnerActorID:    req.Context.ActorID,
		ConnectedAt:     p.now().UTC().Format(time.RFC3339),
		Pending:         pending,
	}
	if err := p.storeJarConnection(ctx, host, state); err != nil {
		if errors.Is(err, errJarConnectionCommitUnknown) {
			// The Host may have committed the sealed state. Keep the only
			// recovery credential and wake the passive publisher; either is
			// harmless if the write was actually rejected.
			p.signalJarPublisher()
			return jarActionError(http.StatusServiceUnavailable, "connection state could not be confirmed"), nil
		}
		p.compensateFailedJarConnect(ctx, host, origin, installationID, token)
		return jarActionError(http.StatusServiceUnavailable, "connection state could not be stored"), nil
	}
	p.signalJarPublisher()
	return jarActionJSON(http.StatusOK, map[string]any{
		"connected":        true,
		"installation_id":  installationID,
		"origin":           origin,
		"pending_revision": pending.Revision,
	}), nil
}

func normalizeJarPairingCode(raw string) (string, error) {
	code := strings.ToUpper(strings.TrimSpace(raw))
	if !jarPairingCodePattern.MatchString(code) {
		return "", fmt.Errorf("invalid pairing code")
	}
	return code, nil
}

func decodeStrictJSON(body []byte, out any) error {
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(out); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return fmt.Errorf("request must contain one JSON value")
	}
	return nil
}

func (p *plugin) configuredJarOrigin(ctx context.Context, host pluginsdk.Host) (string, error) {
	callCtx, cancel := p.boundedContext(ctx)
	defer cancel()
	config, err := host.GetConfig(callCtx)
	if err != nil {
		return "", err
	}
	raw := defaultJarOrigin
	if configured, ok := config[configKeyJarOrigin].(string); ok && strings.TrimSpace(configured) != "" {
		raw = configured
	}
	return normalizeJarOrigin(raw)
}

func newJarPublisherToken() (token, hash string, err error) {
	raw := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, raw); err != nil {
		return "", "", err
	}
	token = "kjp_v1_" + base64.RawURLEncoding.EncodeToString(raw)
	return token, jarPublisherTokenHash(token), nil
}

func jarPublisherTokenHash(token string) string {
	digest := sha256.Sum256([]byte(token))
	return base64.RawURLEncoding.EncodeToString(digest[:])
}

func (p *plugin) redeemJarPairing(ctx context.Context, origin, code, tokenHash string) (string, int, error) {
	request := jarRedeemRequest{
		ProtocolVersion:      jarProtocolVersion,
		UserCode:             code,
		PublisherTokenSHA256: tokenHash,
	}
	for attempt := 0; attempt < 2; attempt++ {
		var response jarRedeemResponse
		status, err := p.doJarJSON(ctx, http.MethodPost, origin, "/api/v1/pairings/redeem", "", request, &response)
		if err != nil {
			if attempt == 0 && jarRedeemRetryable(status) {
				continue
			}
			return "", jarUpstreamStatus(status), err
		}
		if status != http.StatusOK && status != http.StatusCreated {
			return "", jarUpstreamStatus(status), fmt.Errorf("pairing rejected")
		}
		if response.ProtocolVersion != jarProtocolVersion || !jarUUIDPattern.MatchString(response.InstallationID) {
			return "", http.StatusBadGateway, fmt.Errorf("invalid pairing response")
		}
		return strings.ToLower(response.InstallationID), http.StatusOK, nil
	}
	return "", http.StatusBadGateway, fmt.Errorf("pairing failed")
}

func jarRedeemRetryable(status int) bool {
	return status == 0 || status == http.StatusRequestTimeout || status >= 500
}

func (p *plugin) doJarJSON(
	ctx context.Context,
	method, origin, path, bearer string,
	requestBody any,
	responseBody any,
) (int, error) {
	var requestReader io.Reader
	if requestBody != nil {
		raw, err := json.Marshal(requestBody)
		if err != nil {
			return 0, err
		}
		requestReader = bytes.NewReader(raw)
	}
	callCtx, cancel := context.WithTimeout(ctx, jarHTTPTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(callCtx, method, origin+path, requestReader)
	if err != nil {
		return 0, err
	}
	if requestBody != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Accept", "application/json")
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	client := &http.Client{
		Transport: http.DefaultTransport,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	resp, err := client.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	if !jarResponseMatchesOrigin(resp, origin) {
		return resp.StatusCode, fmt.Errorf("response origin mismatch")
	}
	limited := io.LimitReader(resp.Body, jarResponseLimit+1)
	body, err := io.ReadAll(limited)
	if err != nil {
		return resp.StatusCode, err
	}
	if len(body) > jarResponseLimit {
		return resp.StatusCode, fmt.Errorf("response too large")
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return resp.StatusCode, &jarUpstreamResponseError{
			status:      resp.StatusCode,
			contentType: resp.Header.Get("Content-Type"),
			body:        append([]byte(nil), body...),
		}
	}
	if responseBody != nil {
		mediaType, _, err := mime.ParseMediaType(resp.Header.Get("Content-Type"))
		if err != nil || !strings.EqualFold(mediaType, "application/json") {
			return resp.StatusCode, fmt.Errorf("upstream response is not JSON")
		}
		if err := decodeStrictJSON(body, responseBody); err != nil {
			return resp.StatusCode, err
		}
	}
	return resp.StatusCode, nil
}

func jarResponseMatchesOrigin(resp *http.Response, origin string) bool {
	if resp == nil || resp.Request == nil || resp.Request.URL == nil {
		return false
	}
	actual, err := normalizeJarOrigin(resp.Request.URL.Scheme + "://" + resp.Request.URL.Host)
	return err == nil && actual == origin
}

func jarUpstreamStatus(status int) int {
	switch status {
	case http.StatusBadRequest, http.StatusNotFound, http.StatusConflict, http.StatusGone, http.StatusUnprocessableEntity:
		return http.StatusBadRequest
	case http.StatusTooManyRequests:
		return http.StatusTooManyRequests
	default:
		return http.StatusBadGateway
	}
}

func (p *plugin) loadJarConnection(ctx context.Context, host pluginsdk.Host) (jarConnectionState, bool, error) {
	value, found, err := p.getState(ctx, host, jarConnectionStateKey)
	if err != nil || !found {
		return jarConnectionState{}, found, err
	}
	raw, err := json.Marshal(value)
	if err != nil {
		return jarConnectionState{}, false, err
	}
	var state jarConnectionState
	if err := decodeStrictJSON(raw, &state); err != nil {
		return jarConnectionState{}, false, err
	}
	// There is intentionally no unsigned-state grandfather path. An old
	// unsigned row cannot be distinguished from one whose origin or outbox
	// was forged, so it must fail closed and be paired again.
	if state.StateVersion != jarConnectionStateVersion ||
		state.SealVersion != jarConnectionSealVersion || state.Sig == "" {
		return jarConnectionState{}, false, fmt.Errorf("unsealed connection state")
	}
	key, err := p.existingJarConnectionSealKey(ctx, host)
	if err != nil {
		return jarConnectionState{}, false, err
	}
	if !jarConnectionSealValid(state, key) {
		return jarConnectionState{}, false, fmt.Errorf("invalid connection state seal")
	}
	if state.ProtocolVersion != jarProtocolVersion ||
		!jarUUIDPattern.MatchString(state.InstallationID) || state.OwnerActorID == "" {
		return jarConnectionState{}, false, fmt.Errorf("invalid connection state")
	}
	normalizedOrigin, err := normalizeJarOrigin(state.Origin)
	if err != nil || normalizedOrigin != state.Origin {
		return jarConnectionState{}, false, fmt.Errorf("invalid connection origin")
	}
	if state.AckedRevision < 0 || state.AckedRevision > jarMaxSafeRevision {
		return jarConnectionState{}, false, fmt.Errorf("invalid acknowledged revision")
	}
	if state.Pending != nil && (state.Pending.Revision <= state.AckedRevision || state.Pending.Revision > jarMaxSafeRevision) {
		return jarConnectionState{}, false, fmt.Errorf("invalid pending revision")
	}
	return state, true, nil
}

func (p *plugin) storeJarConnection(ctx context.Context, host pluginsdk.Host, state jarConnectionState) error {
	key, _, err := p.ensureSealKey(ctx, host)
	if err != nil {
		return err
	}
	state.StateVersion = jarConnectionStateVersion
	state.SealVersion = jarConnectionSealVersion
	state.Sig = jarConnectionSignature(state, key)
	if state.Sig == "" {
		return fmt.Errorf("connection state could not be sealed")
	}
	raw, err := json.Marshal(state)
	if err != nil {
		return err
	}
	var value map[string]any
	if err := json.Unmarshal(raw, &value); err != nil {
		return err
	}
	writeErr := p.setState(ctx, host, jarConnectionStateKey, value)
	if writeErr == nil {
		return nil
	}
	if err := p.setState(ctx, host, jarConnectionStateKey, value); err == nil {
		return nil
	}

	// Host writes are not transactional from the caller's point of view: a
	// response can be lost after the state committed. Retry exact reads without
	// inheriting caller cancellation. Only the exact sealed document proves the
	// intended state committed; every other result remains unknown.
	for attempt := 0; attempt < 2; attempt++ {
		readCtx, cancel := p.detachedContext(ctx)
		persisted, found, readErr := p.loadJarConnection(readCtx, host)
		cancel()
		if readErr != nil {
			continue
		}
		if found && reflect.DeepEqual(persisted, state) {
			return nil
		}
	}
	// Missing and different readbacks are not a commit barrier: a timed-out
	// RPC can still commit after both reads. Once a write was attempted, only
	// the exact sealed document proves a safe outcome.
	return fmt.Errorf("%w: %v", errJarConnectionCommitUnknown, writeErr)
}

func jarConnectionSignature(state jarConnectionState, key []byte) string {
	state.Sig = ""
	encoded, err := json.Marshal(state)
	if err != nil {
		return ""
	}
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte(jarConnectionSealDomain))
	_, _ = mac.Write(encoded)
	return hex.EncodeToString(mac.Sum(nil))
}

func jarConnectionSealValid(state jarConnectionState, key []byte) bool {
	if state.StateVersion != jarConnectionStateVersion ||
		state.SealVersion != jarConnectionSealVersion || state.Sig == "" {
		return false
	}
	want := jarConnectionSignature(state, key)
	return want != "" && hmac.Equal([]byte(state.Sig), []byte(want))
}

func (p *plugin) existingJarConnectionSealKey(ctx context.Context, host pluginsdk.Host) ([]byte, error) {
	if cached := p.cachedSealKey(); cached != nil {
		return cached, nil
	}
	p.sealMu.Lock()
	defer p.sealMu.Unlock()
	if cached := p.cachedSealKey(); cached != nil {
		return cached, nil
	}
	hexKey, found, err := p.getSecret(ctx, host, secretKeyLedgerHMAC)
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, fmt.Errorf("connection seal key is unavailable")
	}
	decoded, err := hex.DecodeString(strings.TrimSpace(hexKey))
	if err != nil || len(decoded) == 0 {
		return nil, fmt.Errorf("stored seal key is not valid hex")
	}
	p.publishSealKey(decoded)
	return decoded, nil
}

func (p *plugin) setJarSecret(ctx context.Context, host pluginsdk.Host, origin, token string) error {
	value, err := json.Marshal(jarPublisherSecret{
		Version: jarPublisherSecretVersion,
		Origin:  origin,
		Token:   token,
	})
	if err != nil {
		return err
	}
	callCtx, cancel := p.detachedContext(ctx)
	defer cancel()
	return host.SetSecret(callCtx, jarPublisherSecretKey, string(value))
}

func (p *plugin) getJarSecret(ctx context.Context, host pluginsdk.Host) (jarPublisherSecret, bool, error) {
	callCtx, cancel := p.boundedContext(ctx)
	defer cancel()
	value, found, err := host.GetSecret(callCtx, jarPublisherSecretKey)
	if err != nil || !found {
		return jarPublisherSecret{}, found, err
	}
	var credential jarPublisherSecret
	if err := decodeStrictJSON([]byte(value), &credential); err != nil {
		return jarPublisherSecret{}, false, fmt.Errorf("invalid publisher credential")
	}
	normalizedOrigin, originErr := normalizeJarOrigin(credential.Origin)
	if credential.Version != jarPublisherSecretVersion || originErr != nil ||
		normalizedOrigin != credential.Origin || !jarPublisherPattern.MatchString(credential.Token) {
		return jarPublisherSecret{}, false, fmt.Errorf("invalid publisher credential")
	}
	return credential, true, nil
}

func (p *plugin) deleteJarSecret(ctx context.Context, host pluginsdk.Host) error {
	callCtx, cancel := p.detachedContext(ctx)
	defer cancel()
	return host.DeleteSecret(callCtx, jarPublisherSecretKey)
}

func (p *plugin) deleteJarConnection(ctx context.Context, host pluginsdk.Host) error {
	callCtx, cancel := p.detachedContext(ctx)
	defer cancel()
	return host.DeleteState(callCtx, stateScope, "", jarConnectionStateKey)
}

func (p *plugin) revokeJarPublication(ctx context.Context, origin, installationID, token string) error {
	status, err := p.doJarJSON(ctx, http.MethodDelete, origin,
		"/api/v1/installations/"+url.PathEscape(installationID)+"/publication", token, nil, nil)
	if err != nil {
		if invalidPublisherResponse(err) {
			// A newly paired plugin rotates this installation's credential and
			// atomically unpublishes the old snapshot. The stale client has no
			// remaining remote authority, so it is safe to forget locally.
			return nil
		}
		return err
	}
	if status != http.StatusNoContent {
		return fmt.Errorf("invalid revoke status")
	}
	return nil
}

func invalidPublisherResponse(err error) bool {
	var upstream *jarUpstreamResponseError
	if !errors.As(err, &upstream) || upstream.status != http.StatusUnauthorized {
		return false
	}
	mediaType, _, parseErr := mime.ParseMediaType(upstream.contentType)
	if parseErr != nil || !strings.EqualFold(mediaType, "application/json") {
		return false
	}
	var response struct {
		Error string `json:"error"`
	}
	return decodeStrictJSON(upstream.body, &response) == nil && response.Error == "invalid_publisher"
}

func (p *plugin) compensateFailedJarConnect(ctx context.Context, host pluginsdk.Host, origin, installationID, token string) {
	if !p.revokeFailedJarConnect(ctx, origin, installationID, token) {
		return
	}
	_ = p.deleteJarSecret(ctx, host)
}

func (p *plugin) revokeFailedJarConnect(ctx context.Context, origin, installationID, token string) bool {
	revokeCtx, cancel := p.detachedContext(ctx)
	err := p.revokeJarPublication(revokeCtx, origin, installationID, token)
	cancel()
	if err != nil {
		return false
	}
	return true
}

func jarActionError(status int, message string) *pluginsdk.PluginActionResponse {
	return jarActionJSON(status, map[string]any{"error": message})
}

func jarActionJSON(status int, value any) *pluginsdk.PluginActionResponse {
	body, err := json.Marshal(value)
	if err != nil {
		status = http.StatusInternalServerError
		body = []byte(`{"error":"encoding response"}`)
	}
	return &pluginsdk.PluginActionResponse{
		Status: status,
		Headers: map[string]string{
			"Content-Type":  "application/json",
			"Cache-Control": "no-store",
		},
		Body: body,
	}
}

func normalizeJarOrigin(raw string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Opaque != "" || parsed.Host == "" || parsed.Hostname() == "" || parsed.User != nil {
		return "", fmt.Errorf("invalid Kandy Jar origin")
	}
	if parsed.RawQuery != "" || parsed.ForceQuery || parsed.Fragment != "" || parsed.RawPath != "" || (parsed.Path != "" && parsed.Path != "/") {
		return "", fmt.Errorf("Kandy Jar URL must contain only an origin")
	}

	scheme := strings.ToLower(parsed.Scheme)
	hostname := strings.ToLower(parsed.Hostname())
	if scheme != "https" {
		ip := net.ParseIP(hostname)
		loopback := hostname == "localhost" || (ip != nil && ip.IsLoopback())
		if scheme != "http" || !loopback {
			return "", fmt.Errorf("Kandy Jar origin must use HTTPS outside localhost development")
		}
	}
	return scheme + "://" + strings.ToLower(parsed.Host), nil
}

func projectJarKandy(view kandyResponse) jarKandy {
	ancestorCount := min(len(view.Ancestors), maxAncestors)
	ancestors := make([]jarAncestor, 0, ancestorCount)
	for _, ancestor := range view.Ancestors[:ancestorCount] {
		ancestors = append(ancestors, jarAncestor{
			Level:       ancestor.Level,
			Archetype:   ancestor.Archetype,
			Family:      ancestor.Family,
			LineageSeed: ancestor.LineageSeed,
			StageName:   ancestor.StageName,
			Generation:  ancestor.Generation,
			Scarred:     ancestor.Scarred,
		})
	}
	return jarKandy{
		Level:           view.Level,
		Stage:           view.Stage,
		Archetype:       view.Archetype,
		Family:          view.Family,
		Biome:           view.Biome,
		LineageSeed:     view.LineageSeed,
		StageName:       view.StageName,
		ProgressPct:     view.ProgressPct,
		AppearanceSeed:  view.AppearanceSeed,
		Mood:            view.Mood,
		TemperamentBand: view.TemperamentBand,
		Scarred:         view.Scarred,
		Counterfeit:     view.Counterfeit,
		Generation:      view.Generation,
		Ancestors:       ancestors,
	}
}
