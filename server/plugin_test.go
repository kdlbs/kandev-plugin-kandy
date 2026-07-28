// Package main tests. Exercises the gotchi's OnEvent XP awards, state
// persistence, and webhook presentation end to end against a fake Host —
// no go-plugin spawn (tokscale-plugin test pattern).
package main

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/kandev/kandev/pkg/pluginsdk"
	"github.com/stretchr/testify/require"
)

// fakeHost serves state and config from memory — the only Host surfaces
// this plugin uses.
type fakeHost struct {
	pluginsdk.UnimplementedHostData
	config map[string]any
	state  map[string]map[string]any
}

func newFakeHost(config map[string]any) *fakeHost {
	return &fakeHost{config: config, state: map[string]map[string]any{}}
}

func stateMapKey(scope, scopeID, key string) string { return scope + "|" + scopeID + "|" + key }

func (h *fakeHost) GetState(_ context.Context, scope, scopeID, key string) (map[string]any, bool, error) {
	value, ok := h.state[stateMapKey(scope, scopeID, key)]
	return value, ok, nil
}
func (h *fakeHost) SetState(_ context.Context, scope, scopeID, key string, value map[string]any) error {
	h.state[stateMapKey(scope, scopeID, key)] = value
	return nil
}
func (h *fakeHost) DeleteState(_ context.Context, scope, scopeID, key string) error {
	delete(h.state, stateMapKey(scope, scopeID, key))
	return nil
}
func (h *fakeHost) ListState(context.Context, string, string) ([]pluginsdk.StateEntry, error) {
	return nil, nil
}
func (h *fakeHost) GetConfig(context.Context) (map[string]any, error) {
	if h.config == nil {
		return map[string]any{}, nil
	}
	return h.config, nil
}
func (h *fakeHost) RevealSecret(context.Context, string) (string, error) { return "", nil }
func (h *fakeHost) GetSecret(context.Context, string) (string, bool, error) {
	return "", false, nil
}
func (h *fakeHost) SetSecret(context.Context, string, string) error         { return nil }
func (h *fakeHost) DeleteSecret(context.Context, string) error              { return nil }
func (h *fakeHost) EmitEvent(context.Context, string, map[string]any) error { return nil }

func newTestPlugin(t *testing.T, host *fakeHost) *plugin {
	t.Helper()
	p := newPlugin()
	p.now = func() time.Time { return time.Date(2026, 7, 28, 12, 0, 0, 0, time.UTC) }
	p.saltFunc = func() uint32 { return 42 }
	p.SetHost(host)
	return p
}

func busEvent(eventType string, payload map[string]any) *pluginsdk.Event {
	return &pluginsdk.Event{EventID: "evt-1", EventType: eventType, Payload: payload}
}

func gotchiState(t *testing.T, resp *pluginsdk.WebhookResponse) gotchiResponse {
	t.Helper()
	require.Equal(t, int32(200), resp.Status)
	require.Equal(t, "application/json", resp.Headers["Content-Type"])
	var out gotchiResponse
	require.NoError(t, json.Unmarshal(resp.Body, &out))
	return out
}

func fetchGotchi(t *testing.T, p *plugin, query string) gotchiResponse {
	t.Helper()
	resp, err := p.HandleWebhook(context.Background(),
		&pluginsdk.WebhookRequest{WebhookKey: webhookKeyGotchi, Method: "GET", Query: query})
	require.NoError(t, err)
	return gotchiState(t, resp)
}

func persistedXP(t *testing.T, host *fakeHost) float64 {
	t.Helper()
	value, ok := host.state[stateMapKey(stateScope, "", stateKey)]
	require.True(t, ok, "ledger persisted")
	xp, _ := value["xp"].(float64)
	return xp
}

func TestOnEvent_AwardsHiddenXP(t *testing.T) {
	host := newFakeHost(nil)
	p := newTestPlugin(t, host)
	ctx := context.Background()

	require.NoError(t, p.OnEvent(ctx, busEvent("message.added", map[string]any{"message_id": "m1"})))
	require.NoError(t, p.OnEvent(ctx, busEvent("turn.completed", map[string]any{"id": "t1"})))
	require.NoError(t, p.OnEvent(ctx, busEvent("agent.completed", map[string]any{"agent_id": "a1"})))
	require.NoError(t, p.OnEvent(ctx, busEvent("task.state_changed",
		map[string]any{"old_state": "IN_PROGRESS", "new_state": "COMPLETED"})))

	require.Equal(t, 1.0+8+20+150, persistedXP(t, host))

	state := fetchGotchi(t, p, "")
	require.Equal(t, 2, state.Level, "179 XP crosses the level-2 threshold (150)")
	require.NotEqual(t, "Egg", state.StageName)
}

func TestOnEvent_TaskStateChangedToNonDoneAwardsNothing(t *testing.T) {
	host := newFakeHost(nil)
	p := newTestPlugin(t, host)
	require.NoError(t, p.OnEvent(context.Background(), busEvent("task.state_changed",
		map[string]any{"old_state": "TODO", "new_state": "IN_PROGRESS"})))
	require.Empty(t, host.state, "no ledger write for zero-XP events")
}

func TestOnEvent_UnknownEventIsNoOp(t *testing.T) {
	host := newFakeHost(nil)
	p := newTestPlugin(t, host)
	require.NoError(t, p.OnEvent(context.Background(), busEvent("workspace.created", nil)))
	require.Empty(t, host.state)
}

func TestOnEvent_MalformedPayloadReturnsNil(t *testing.T) {
	host := newFakeHost(nil)
	p := newTestPlugin(t, host)
	ctx := context.Background()
	// Retries reuse the same EventID, so returning an error here would let
	// kandev redeliver and farm duplicate XP — malformed payloads must be
	// swallowed.
	require.NoError(t, p.OnEvent(ctx, busEvent("task.state_changed", nil)))
	require.NoError(t, p.OnEvent(ctx, busEvent("task.state_changed", map[string]any{"new_state": 7.0})))
	require.NoError(t, p.OnEvent(ctx, nil))
	require.Empty(t, host.state)
}

func TestStateRoundTrip_SurvivesRestart(t *testing.T) {
	host := newFakeHost(nil)
	p1 := newTestPlugin(t, host)
	ctx := context.Background()
	for i := 0; i < 30; i++ {
		require.NoError(t, p1.OnEvent(ctx, busEvent("turn.completed", map[string]any{})))
	}
	before := fetchGotchi(t, p1, "")

	// A fresh plugin process (new cache) against the same Host state.
	p2 := newTestPlugin(t, host)
	after := fetchGotchi(t, p2, "")
	require.Equal(t, before.Level, after.Level)
	require.Equal(t, before.StageName, after.StageName)
	require.Equal(t, before.AppearanceSeed, after.AppearanceSeed)
	require.Equal(t, before.AliveSince, after.AliveSince)
}

func TestWebhook_ShapeAndHiddenFactors(t *testing.T) {
	host := newFakeHost(nil)
	p := newTestPlugin(t, host)
	require.NoError(t, p.OnEvent(context.Background(), busEvent("turn.completed", map[string]any{})))

	state := fetchGotchi(t, p, "")
	require.GreaterOrEqual(t, state.Level, 1)
	require.NotEmpty(t, state.StageName)
	require.GreaterOrEqual(t, state.ProgressPct, 0.0)
	require.Less(t, state.ProgressPct, 100.0)
	require.NotZero(t, state.AppearanceSeed)
	require.NotEmpty(t, state.Flavor)
	require.NotEmpty(t, state.AliveSince)

	// The hidden-factors requirement: raw counters and the XP ledger never
	// appear in the webhook body.
	resp, err := p.HandleWebhook(context.Background(),
		&pluginsdk.WebhookRequest{WebhookKey: webhookKeyGotchi, Method: "GET"})
	require.NoError(t, err)
	var raw map[string]any
	require.NoError(t, json.Unmarshal(resp.Body, &raw))
	for _, banned := range []string{"xp", "messages", "turns", "agent_runs", "tasks_done", "salt"} {
		require.NotContains(t, raw, banned)
	}
}

func TestWebhook_UnknownKey(t *testing.T) {
	p := newTestPlugin(t, newFakeHost(nil))
	resp, err := p.HandleWebhook(context.Background(),
		&pluginsdk.WebhookRequest{WebhookKey: "nope", Method: "GET"})
	require.NoError(t, err)
	require.Equal(t, int32(404), resp.Status)
}

func TestDebugGrant_RequiresDebugConfig(t *testing.T) {
	host := newFakeHost(nil) // debug not enabled
	p := newTestPlugin(t, host)

	resp, err := p.HandleWebhook(context.Background(),
		&pluginsdk.WebhookRequest{WebhookKey: webhookKeyGotchi, Method: "GET", Query: "debug_grant=5000"})
	require.NoError(t, err)
	require.Equal(t, int32(403), resp.Status)
	require.Empty(t, host.state, "no XP granted while debug is off")
}

func TestDebugGrant_GrantsWhenDebugEnabled(t *testing.T) {
	host := newFakeHost(map[string]any{"debug": true})
	p := newTestPlugin(t, host)

	state := fetchGotchi(t, p, "debug_grant=5000")
	require.Equal(t, 5000.0, persistedXP(t, host))
	require.Equal(t, levelForXP(5000), state.Level)
	require.Greater(t, state.Level, 2)
}

func TestDebugGrant_RejectsJunk(t *testing.T) {
	host := newFakeHost(map[string]any{"debug": true})
	p := newTestPlugin(t, host)
	for _, grant := range []string{"abc", "-5", "0", "10000000000000"} {
		resp, err := p.HandleWebhook(context.Background(),
			&pluginsdk.WebhookRequest{WebhookKey: webhookKeyGotchi, Method: "GET", Query: "debug_grant=" + grant})
		require.NoError(t, err)
		require.Equal(t, int32(400), resp.Status, "grant=%s", grant)
	}
	require.Empty(t, host.state)
}

func TestStageNameStableAcrossCalls(t *testing.T) {
	host := newFakeHost(map[string]any{"debug": true})
	p := newTestPlugin(t, host)
	first := fetchGotchi(t, p, "debug_grant=100000")
	second := fetchGotchi(t, p, "")
	require.Equal(t, first.Level, second.Level)
	require.Equal(t, first.StageName, second.StageName)
	require.Equal(t, first.AppearanceSeed, second.AppearanceSeed)
}
