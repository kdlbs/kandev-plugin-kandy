// Lock discipline regression tests (v0.13.0).
//
// The defect these pin down: every handler used to serialize on one mutex,
// and that mutex was held across Host round-trips. One slow Host call made
// the plugin stop answering events, webhooks AND kandev's health check —
// the state kandev reports as `status: error`, where it can neither disable
// the plugin nor shut down cleanly.
//
// So these tests assert timing, not just results. They are deliberately
// generous (whole multiples of the injected latency) so they fail on a
// reintroduced lock-across-RPC and not on a loaded CI box.
package main

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/kandev/kandev/pkg/pluginsdk"
	"github.com/stretchr/testify/require"
)

// slowGate is a Host gate that takes delay to answer and honours ctx exactly
// as the real gRPC client does.
func slowGate(delay time.Duration) func(context.Context) error {
	return func(ctx context.Context) error {
		timer := time.NewTimer(delay)
		defer timer.Stop()
		select {
		case <-timer.C:
			return nil
		case <-ctx.Done():
			return ctx.Err()
		}
	}
}

// wedgedGate never answers until the test tears down. This is the incident
// shape: kandev is up enough to accept the call and never completes it.
func wedgedGate(release <-chan struct{}) func(context.Context) error {
	return func(ctx context.Context) error {
		select {
		case <-release:
			return nil
		case <-ctx.Done():
			return ctx.Err()
		}
	}
}

// pollInterval paces the simulated UI poll. The real UI polls every 1-3s;
// the tests run three orders of magnitude faster so a storm still overlaps
// many polls, without spinning hot enough to distort the latency it measures.
const pollInterval = 2 * time.Millisecond

func deliveryEvent(id, eventType string) *pluginsdk.Event {
	return &pluginsdk.Event{EventID: id, EventType: eventType, Payload: map[string]any{"id": id}}
}

// warmPlugin runs one delivery and one webhook against a healthy Host so the
// ledger, grotto and seal key are all cached. Everything after this is
// steady state, which is where the incident lived.
func warmPlugin(t *testing.T, p *plugin) {
	t.Helper()
	require.NoError(t, p.OnEvent(context.Background(), deliveryEvent("warmup", eventMessageAdded)))
	fetchKandy(t, p, "")
}

func inMemoryXP(t *testing.T, p *plugin) float64 {
	t.Helper()
	l, cached := p.ledgerSnapshot(context.Background())
	require.True(t, cached, "ledger is cached")
	return l.XP
}

func TestLockDiscipline_WebhookStaysResponsiveWhileEventsPersist(t *testing.T) {
	const (
		deliveries  = 120
		hostLatency = 15 * time.Millisecond
		// The read webhook must not touch the Host at all once warm, so
		// even one round-trip on that path blows this budget.
		readBudget = 4 * hostLatency
		// Pet and bonk mutate, so they may pay for at most their own
		// bounded write — never for the whole event backlog.
		careBudget = 8 * hostLatency
	)
	host := newFakeHost(nil)
	p := newTestPlugin(t, host)
	ctx := context.Background()
	warmPlugin(t, p)
	host.setGate(slowGate(hostLatency))

	events := make(chan struct{})
	var wg sync.WaitGroup
	for i := 0; i < deliveries; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-events
			// The always-return-nil contract: kandev retries a failed
			// delivery with the SAME EventID and Kandy has no per-event
			// dedup, so an error here IS a double award.
			if err := p.OnEvent(ctx, deliveryEvent(fmt.Sprintf("turn-%03d", i), eventTurnCompleted)); err != nil {
				t.Errorf("OnEvent(%d) returned %v, which would make kandev retry and double-award", i, err)
			}
		}(i)
	}

	done := make(chan struct{})
	go func() { wg.Wait(); close(done) }()
	close(events)

	var worstRead, worstPet, worstBonk time.Duration
	polls := 0
	for finished := false; !finished; {
		select {
		case <-done:
			finished = true
		case <-time.After(pollInterval):
		}
		worstRead = max(worstRead, timeWebhook(t, p, webhookKeyKandy, "GET"))
		worstPet = max(worstPet, timeWebhook(t, p, webhookKeyPet, "POST"))
		worstBonk = max(worstBonk, timeWebhook(t, p, webhookKeyBonk, "POST"))
		polls++
	}
	<-done

	require.Greater(t, polls, 1, "the event storm finished before a single poll — raise deliveries")
	require.Less(t, worstRead, readBudget,
		"the kandy webhook (the UI's 1-3s poll and the surface kandev health-checks) queued behind an event persist")
	require.Less(t, worstPet, careBudget, "pet queued behind the event backlog")
	require.Less(t, worstBonk, careBudget, "bonk queued behind the event backlog")

	// Exactness: one award per delivery, no more and no less, even though
	// the persists were coalesced.
	host.setGate(nil)
	want := xpMessageAdded + deliveries*xpTurnCompleted
	require.Equal(t, want, inMemoryXP(t, p))
	require.Equal(t, int64(deliveries+1), currentLedger(t, p).AwardSeq)
	require.Equal(t, int64(deliveries), currentLedger(t, p).Turns)

	// ...and the coalesced writes converge on that same total: the last
	// writer out drains whatever landed while it was mid-flight.
	require.Eventually(t, func() bool { return persistedXP(t, host) == want }, 2*time.Second, 10*time.Millisecond,
		"the final in-memory ledger never reached Host state")
}

func currentLedger(t *testing.T, p *plugin) *ledger {
	t.Helper()
	l, cached := p.ledgerSnapshot(context.Background())
	require.True(t, cached)
	return l
}

func timeWebhook(t *testing.T, p *plugin, key, method string) time.Duration {
	t.Helper()
	start := time.Now()
	resp, err := p.HandleWebhook(context.Background(), &pluginsdk.WebhookRequest{WebhookKey: key, Method: method})
	elapsed := time.Since(start)
	require.NoError(t, err)
	require.Equal(t, int32(200), resp.Status)
	return elapsed
}

func TestLockDiscipline_FailingPersistNeverSurfacesAsRetryableError(t *testing.T) {
	const deliveries = 32
	host := newFakeHost(nil)
	p := newTestPlugin(t, host)
	ctx := context.Background()
	warmPlugin(t, p)

	host.mu.Lock()
	host.setStateErr[stateMapKey(stateScope, "", stateKey)] = fmt.Errorf("host write rejected")
	host.mu.Unlock()

	var wg sync.WaitGroup
	for i := 0; i < deliveries; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			if err := p.OnEvent(ctx, deliveryEvent(fmt.Sprintf("agent-%03d", i), eventAgentCompleted)); err != nil {
				t.Errorf("OnEvent(%d) returned %v; kandev would retry the same EventID and award twice", i, err)
			}
		}(i)
	}
	wg.Wait()

	// The awards are still exact in memory — a dropped write must not
	// double-count or half-count anything.
	require.Equal(t, xpMessageAdded+deliveries*xpAgentCompleted, inMemoryXP(t, p))

	// And once the Host recovers, the next award carries the whole backlog
	// across: nothing was lost to the outage.
	host.mu.Lock()
	delete(host.setStateErr, stateMapKey(stateScope, "", stateKey))
	host.mu.Unlock()
	require.NoError(t, p.OnEvent(ctx, deliveryEvent("recovery", eventMessageAdded)))
	require.Equal(t, 2*xpMessageAdded+deliveries*xpAgentCompleted, persistedXP(t, host))
}

func TestLockDiscipline_WedgedHostCannotParkEventsOrWebhooks(t *testing.T) {
	const timeout = 80 * time.Millisecond
	release := make(chan struct{})
	defer close(release)

	host := newFakeHost(nil)
	p := newTestPlugin(t, host)
	p.hostTimeout = timeout
	warmPlugin(t, p)
	host.setGate(wedgedGate(release))

	// Warm: the read webhook answers with zero Host round-trips, so a
	// completely wedged kandev is invisible to the poll and to the health
	// check riding the same transport. Assert the round-trip count, not just
	// the latency — that is the property, the speed is only its symptom.
	before := host.calls.Load()
	require.Less(t, timeWebhook(t, p, webhookKeyKandy, "GET"), timeout,
		"a warm read webhook must not touch the Host at all")
	require.Equal(t, before, host.calls.Load(), "the warm read path made a Host call")

	// An event pays for its own bounded write and no more.
	require.Less(t, timeCall(t, func() {
		require.NoError(t, p.OnEvent(context.Background(), deliveryEvent("wedged", eventTurnCompleted)))
	}), 4*timeout, "OnEvent parked on a wedged Host")

	// Pet and bonk mutate too, and stay bounded the same way.
	require.Less(t, timeWebhook(t, p, webhookKeyPet, "POST"), 4*timeout, "pet parked on a wedged Host")
	require.Less(t, timeWebhook(t, p, webhookKeyBonk, "POST"), 4*timeout, "bonk parked on a wedged Host")

	// The XP still landed in memory, so it persists once the Host recovers.
	require.Equal(t, xpMessageAdded+xpTurnCompleted, inMemoryXP(t, p))
}

func TestLockDiscipline_ColdStartOnWedgedHostStillAnswers(t *testing.T) {
	const timeout = 60 * time.Millisecond
	release := make(chan struct{})
	defer close(release)

	host := newFakeHost(nil)
	p := newTestPlugin(t, host)
	p.hostTimeout = timeout
	host.setGate(wedgedGate(release))

	// Nothing is cached, so every path has to try the Host — and every one
	// of those tries is bounded. A cold webhook serves the transient egg
	// rather than hanging until kandev gives up on the plugin.
	require.Less(t, timeWebhook(t, p, webhookKeyKandy, "GET"), 10*timeout, "cold webhook parked on a wedged Host")
	require.Less(t, timeCall(t, func() {
		require.NoError(t, p.OnEvent(context.Background(), deliveryEvent("cold", eventTurnCompleted)))
	}), 10*timeout, "cold OnEvent parked on a wedged Host")
	require.Less(t, timeCall(t, func() {
		require.NoError(t, p.OnEvent(context.Background(), tokenUsageFixture(
			"cold-usage", "codex-acp", "gpt-5.6", 7, time.Date(2026, 7, 28, 12, 0, 0, 0, time.UTC))))
	}), 10*timeout, "cold token-usage delivery parked on a wedged Host")
}

func TestLockDiscipline_ConcurrentTokenUsageKeepsTotalsExact(t *testing.T) {
	const (
		deliveries  = 60
		hostLatency = 5 * time.Millisecond
	)
	host := newFakeHost(nil)
	p := newTestPlugin(t, host)
	ctx := context.Background()
	warmPlugin(t, p)
	base := time.Date(2026, 7, 28, 12, 0, 0, 0, time.UTC)
	host.setGate(slowGate(hostLatency))

	start := make(chan struct{})
	var wg sync.WaitGroup
	for i := 0; i < deliveries; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			event := tokenUsageFixture(fmt.Sprintf("usage-%03d", i), "codex-acp", "gpt-5.6", 1, base.Add(time.Duration(i)*time.Second))
			if err := p.OnEvent(ctx, event); err != nil {
				t.Errorf("OnEvent(%d) returned %v", i, err)
			}
			// A duplicate body must be deduped no matter which goroutine
			// observes it first.
			if err := p.OnEvent(ctx, event); err != nil {
				t.Errorf("duplicate OnEvent(%d) returned %v", i, err)
			}
		}(i)
	}

	done := make(chan struct{})
	go func() { wg.Wait(); close(done) }()
	close(start)

	// The read webhook keeps answering while the grotto writer is busy.
	var worstRead time.Duration
	for finished := false; !finished; {
		select {
		case <-done:
			finished = true
		case <-time.After(pollInterval):
		}
		worstRead = max(worstRead, timeWebhook(t, p, webhookKeyKandy, "GET"))
	}
	<-done
	require.Less(t, worstRead, 4*hostLatency, "the kandy webhook queued behind a token-grotto persist")

	host.setGate(nil)
	require.Equal(t, fmt.Sprint(deliveries), fetchKandy(t, p, "").TokenGrotto.TotalTokens,
		"every observation counted exactly once")
	// Token usage never feeds XP: only the warm-up message may show up.
	require.Equal(t, xpMessageAdded, inMemoryXP(t, p))
}

func timeCall(t *testing.T, fn func()) time.Duration {
	t.Helper()
	start := time.Now()
	fn()
	return time.Since(start)
}
