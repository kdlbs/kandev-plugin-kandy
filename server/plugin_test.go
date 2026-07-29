// Package main tests. Exercises the kandy's OnEvent XP awards, state
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

func kandyState(t *testing.T, resp *pluginsdk.WebhookResponse) kandyResponse {
	t.Helper()
	require.Equal(t, int32(200), resp.Status)
	require.Equal(t, "application/json", resp.Headers["Content-Type"])
	// Level/XP change as work lands — a cacheable body would show a stale
	// creature until the page is reloaded.
	require.Equal(t, "no-store", resp.Headers["Cache-Control"])
	var out kandyResponse
	require.NoError(t, json.Unmarshal(resp.Body, &out))
	return out
}

func fetchKandy(t *testing.T, p *plugin, query string) kandyResponse {
	t.Helper()
	resp, err := p.HandleWebhook(context.Background(),
		&pluginsdk.WebhookRequest{WebhookKey: webhookKeyKandy, Method: "GET", Query: query})
	require.NoError(t, err)
	return kandyState(t, resp)
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

	require.Equal(t, 1.0+8+20, persistedXP(t, host))

	state := fetchKandy(t, p, "")
	require.Equal(t, levelForXP(29), state.Level, "level derives from the hidden ledger")
	require.Equal(t, archetypeForLineage(42), state.Archetype)
	require.Equal(t, int64(3), state.AwardSeq, "every award bumps the sequence")
	require.Equal(t, "elated", state.Mood, "just fed")
}

// Task lifecycle events must award NOTHING: creating and archiving a task
// is free and repeatable, so task-completion XP was an abuse vector. Only
// agent activity (turns, runs, messages) feeds the kandy.
func TestOnEvent_TaskLifecycleAwardsNothing(t *testing.T) {
	host := newFakeHost(nil)
	p := newTestPlugin(t, host)
	ctx := context.Background()

	require.NoError(t, p.OnEvent(ctx, busEvent("task.state_changed",
		map[string]any{"task_id": "t-done", "old_state": "IN_PROGRESS", "new_state": "COMPLETED"})))
	require.NoError(t, p.OnEvent(ctx, busEvent("task.updated",
		map[string]any{"task_id": "t-arch", "archived_at": "2026-07-29T00:00:00Z", "state": "REVIEW"})))
	require.NoError(t, p.OnEvent(ctx, busEvent("task.created",
		map[string]any{"task_id": "t-new"})))
	require.Empty(t, host.state, "no ledger write for task lifecycle events")
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
	before := fetchKandy(t, p1, "")

	// A fresh plugin process (new cache) against the same Host state.
	p2 := newTestPlugin(t, host)
	after := fetchKandy(t, p2, "")
	require.Equal(t, before.Level, after.Level)
	require.Equal(t, before.StageName, after.StageName)
	require.Equal(t, before.AppearanceSeed, after.AppearanceSeed)
	require.Equal(t, before.AliveSince, after.AliveSince)
}

func TestWebhook_ShapeAndHiddenFactors(t *testing.T) {
	host := newFakeHost(nil)
	p := newTestPlugin(t, host)
	require.NoError(t, p.OnEvent(context.Background(), busEvent("turn.completed", map[string]any{})))

	state := fetchKandy(t, p, "")
	require.GreaterOrEqual(t, state.Level, 1)
	require.GreaterOrEqual(t, state.Archetype, 0)
	require.Less(t, state.Archetype, numArchetypes)
	require.Less(t, state.Family, numFamilies)
	require.Less(t, state.Biome, numBiomes)
	require.NotZero(t, state.LineageSeed)
	require.NotEmpty(t, state.StageName)
	require.GreaterOrEqual(t, state.ProgressPct, 0.0)
	require.Less(t, state.ProgressPct, 100.0)
	require.NotZero(t, state.AppearanceSeed)
	require.NotEmpty(t, state.Flavor)
	require.NotEmpty(t, state.AliveSince)

	// The hidden-factors requirement: raw counters and the XP ledger never
	// appear in the webhook body.
	resp, err := p.HandleWebhook(context.Background(),
		&pluginsdk.WebhookRequest{WebhookKey: webhookKeyKandy, Method: "GET"})
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
		&pluginsdk.WebhookRequest{WebhookKey: webhookKeyKandy, Method: "GET", Query: "debug_grant=5000"})
	require.NoError(t, err)
	require.Equal(t, int32(403), resp.Status)
	require.Empty(t, host.state, "no XP granted while debug is off")
}

func TestDebugGrant_GrantsWhenDebugEnabled(t *testing.T) {
	host := newFakeHost(map[string]any{"debug": true})
	p := newTestPlugin(t, host)

	state := fetchKandy(t, p, "debug_grant=5000")
	require.Equal(t, 5000.0, persistedXP(t, host))
	require.Equal(t, levelForXP(5000), state.Level)
	require.Greater(t, state.Level, 2)
}

func TestDebugGrant_RejectsJunk(t *testing.T) {
	host := newFakeHost(map[string]any{"debug": true})
	p := newTestPlugin(t, host)
	for _, grant := range []string{"abc", "-5", "0", "10000000000000"} {
		resp, err := p.HandleWebhook(context.Background(),
			&pluginsdk.WebhookRequest{WebhookKey: webhookKeyKandy, Method: "GET", Query: "debug_grant=" + grant})
		require.NoError(t, err)
		require.Equal(t, int32(400), resp.Status, "grant=%s", grant)
	}
	require.Empty(t, host.state)
}

func TestWebhook_MoodFromLastAward(t *testing.T) {
	host := newFakeHost(nil)
	p := newTestPlugin(t, host)
	ctx := context.Background()
	require.NoError(t, p.OnEvent(ctx, busEvent("turn.completed", map[string]any{})))

	// Just fed -> elated; advance the clock and the mood decays.
	require.Equal(t, "elated", fetchKandy(t, p, "").Mood)
	base := p.now()
	p.now = func() time.Time { return base.Add(9 * time.Hour) }
	state := fetchKandy(t, p, "")
	require.Equal(t, "content", state.Mood)
	p.now = func() time.Time { return base.Add(200 * time.Hour) }
	require.Equal(t, "gloomy", fetchKandy(t, p, "").Mood)
}

func TestWebhook_MoodMigrationDefaults(t *testing.T) {
	// Pre-0.6 state: no last_award_at — fall back to updated_at.
	host := newFakeHost(nil)
	host.state[stateMapKey(stateScope, "", stateKey)] = map[string]any{
		"xp": 600.0, "salt": 42.0,
		"updated_at": "2026-07-28T00:00:00Z", // 36h before the fixed test clock
	}
	p := newTestPlugin(t, host)
	require.Equal(t, "content", fetchKandy(t, p, "").Mood)

	// No timestamps at all: treat as now, never as ancient.
	host2 := newFakeHost(nil)
	host2.state[stateMapKey(stateScope, "", stateKey)] = map[string]any{"xp": 600.0, "salt": 42.0}
	p2 := newTestPlugin(t, host2)
	require.Equal(t, "elated", fetchKandy(t, p2, "").Mood)
}

func TestDebugIdleHours_GatedAndOverrides(t *testing.T) {
	// Debug off: 403 and no state served.
	p := newTestPlugin(t, newFakeHost(nil))
	resp, err := p.HandleWebhook(context.Background(),
		&pluginsdk.WebhookRequest{WebhookKey: webhookKeyKandy, Method: "GET", Query: "debug_idle_hours=120"})
	require.NoError(t, err)
	require.Equal(t, int32(403), resp.Status)

	// Debug on: junk rejected, valid values override the mood clock.
	host := newFakeHost(map[string]any{"debug": true})
	p2 := newTestPlugin(t, host)
	require.NoError(t, p2.OnEvent(context.Background(), busEvent("turn.completed", map[string]any{})))
	for _, junk := range []string{"abc", "-4", "NaN", "10000000"} {
		resp, err := p2.HandleWebhook(context.Background(),
			&pluginsdk.WebhookRequest{WebhookKey: webhookKeyKandy, Method: "GET", Query: "debug_idle_hours=" + junk})
		require.NoError(t, err)
		require.Equal(t, int32(400), resp.Status, "junk=%s", junk)
	}
	for hours, want := range map[string]string{
		"0": "elated", "1": "happy", "24": "content", "60": "bored", "120": "sad", "200": "gloomy",
	} {
		state := fetchKandy(t, p2, "debug_idle_hours="+hours)
		require.Equal(t, want, state.Mood, "hours=%s", hours)
	}
}

func petKandy(t *testing.T, p *plugin) kandyResponse {
	t.Helper()
	resp, err := p.HandleWebhook(context.Background(),
		&pluginsdk.WebhookRequest{WebhookKey: webhookKeyPet, Method: "POST"})
	require.NoError(t, err)
	return kandyState(t, resp)
}

func TestPet_StampsFieldWithoutTouchingXP(t *testing.T) {
	host := newFakeHost(nil)
	p := newTestPlugin(t, host)
	ctx := context.Background()
	require.NoError(t, p.OnEvent(ctx, busEvent("turn.completed", map[string]any{})))
	before := fetchKandy(t, p, "")

	petted := petKandy(t, p)

	// XP-derived facts are untouched: petting is never an award.
	require.Equal(t, before.Level, petted.Level)
	require.Equal(t, before.ProgressPct, petted.ProgressPct)
	require.Equal(t, before.AwardSeq, petted.AwardSeq)
	require.Equal(t, 8.0, persistedXP(t, host))
	// But the stamp landed.
	value := host.state[stateMapKey(stateScope, "", stateKey)]
	stamp, _ := value["last_petted_at"].(string)
	require.NotEmpty(t, stamp)
}

func TestPet_LiftsMoodOneTierCappedAtHappy(t *testing.T) {
	host := newFakeHost(nil)
	p := newTestPlugin(t, host)
	ctx := context.Background()
	require.NoError(t, p.OnEvent(ctx, busEvent("turn.completed", map[string]any{})))
	base := p.now()

	// bored (60h idle) + fresh pet => content.
	p.now = func() time.Time { return base.Add(60 * time.Hour) }
	require.Equal(t, "bored", fetchKandy(t, p, "").Mood)
	petted := petKandy(t, p)
	require.Equal(t, "content", petted.Mood)

	// gloomy petted becomes merely sad, with the hungry-purr flavor.
	p.now = func() time.Time { return base.Add(300 * time.Hour) }
	require.Equal(t, "gloomy", fetchKandy(t, p, "").Mood)
	state := petKandy(t, p)
	require.Equal(t, "sad", state.Mood)
	require.Contains(t, state.Flavor, "purrs")
	require.Contains(t, state.Flavor, "hungry")

	// content + pet => happy; happy/elated never go higher.
	p.now = func() time.Time { return base.Add(10 * time.Hour) }
	require.Equal(t, "happy", petKandy(t, p).Mood, "content lifts to happy")
	p.now = func() time.Time { return base.Add(1 * time.Hour) }
	require.Equal(t, "happy", petKandy(t, p).Mood, "happy stays happy — petting cannot fake elated")
	p.now = func() time.Time { return base.Add(time.Minute) }
	require.Equal(t, "elated", petKandy(t, p).Mood, "elated stays elated")
}

func TestPet_LiftExpiresAfterAnHour(t *testing.T) {
	host := newFakeHost(nil)
	p := newTestPlugin(t, host)
	ctx := context.Background()
	require.NoError(t, p.OnEvent(ctx, busEvent("turn.completed", map[string]any{})))
	base := p.now()

	p.now = func() time.Time { return base.Add(60 * time.Hour) }
	require.Equal(t, "content", petKandy(t, p).Mood, "lift active")
	// 59 minutes after the pet the lift still holds; at 61 it's gone.
	p.now = func() time.Time { return base.Add(60*time.Hour + 59*time.Minute) }
	require.Equal(t, "content", fetchKandy(t, p, "").Mood)
	p.now = func() time.Time { return base.Add(60*time.Hour + 61*time.Minute) }
	require.Equal(t, "bored", fetchKandy(t, p, "").Mood, "lift expired")
}

func TestStageNameStableAcrossCalls(t *testing.T) {
	host := newFakeHost(map[string]any{"debug": true})
	p := newTestPlugin(t, host)
	first := fetchKandy(t, p, "debug_grant=100000")
	second := fetchKandy(t, p, "")
	require.Equal(t, first.Level, second.Level)
	require.Equal(t, first.StageName, second.StageName)
	require.Equal(t, first.AppearanceSeed, second.AppearanceSeed)
}
