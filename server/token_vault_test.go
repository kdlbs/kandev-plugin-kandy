package main

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/kandev/kandev/pkg/pluginsdk"
	"github.com/stretchr/testify/require"
)

func TestTokenVault_ObservedUsageAppearsInKandyWebhook(t *testing.T) {
	host := newFakeHost(nil)
	p := newTestPlugin(t, host)
	ctx := context.Background()
	event := &pluginsdk.Event{
		EventID:    "delivery-1",
		EventType:  "session_prompt_usage.updated.session-1",
		OccurredAt: "2026-07-28T12:00:01Z",
		Payload: map[string]any{
			"task_id":    "task-private",
			"session_id": "session-private",
			"agent_id":   "agent-private",
			"agent_type": "claude-acp",
			"model":      "claude-sonnet-4-5",
			"timestamp":  "2026-07-28T12:00:00Z",
			"usage": map[string]any{
				"input_tokens":        float64(6),
				"output_tokens":       float64(7),
				"cached_read_tokens":  float64(16_634),
				"cached_write_tokens": float64(8_421),
				"total_tokens":        float64(25_068),
				"estimated":           false,
			},
		},
	}

	require.NoError(t, p.OnEvent(ctx, event))
	resp, err := p.HandleWebhook(ctx, &pluginsdk.WebhookRequest{WebhookKey: webhookKeyKandy, Method: "GET"})
	require.NoError(t, err)
	var body map[string]any
	require.NoError(t, json.Unmarshal(resp.Body, &body))

	require.Equal(t, map[string]any{
		"status":         "ready",
		"observed_since": "2026-07-28T12:00:00Z",
		"total_tokens":   "25068",
		"rooms": []any{
			map[string]any{
				"agent_type": "claude-acp",
				"label":      "Claude Code",
				"tokens":     "25068",
				"models": []any{
					map[string]any{"name": "claude-sonnet-4-5", "tokens": "25068", "last_seen": "2026-07-28T12:00:00Z"},
				},
			},
		},
	}, body["token_vault"])
}

func TestTokenVault_RejectsUnsafeTokenNumbers(t *testing.T) {
	host := newFakeHost(nil)
	p := newTestPlugin(t, host)
	event := &pluginsdk.Event{
		EventID:   "delivery-unsafe",
		EventType: "session_prompt_usage.updated.session-1",
		Payload: map[string]any{
			"agent_type": "codex-acp",
			"model":      "gpt-5.6",
			"timestamp":  "2026-07-28T12:00:00Z",
			"usage": map[string]any{
				"total_tokens": float64(9_007_199_254_740_992),
			},
		},
	}

	require.NoError(t, p.OnEvent(context.Background(), event))
	resp, err := p.HandleWebhook(context.Background(), &pluginsdk.WebhookRequest{WebhookKey: webhookKeyKandy, Method: "GET"})
	require.NoError(t, err)
	var body map[string]any
	require.NoError(t, json.Unmarshal(resp.Body, &body))
	vault, ok := body["token_vault"].(map[string]any)
	require.True(t, ok)
	require.Equal(t, "partial", vault["status"])
	require.Equal(t, "0", vault["total_tokens"])
}

func TestTokenVault_DuplicateDeliveryIDCountsOnceAcrossRestart(t *testing.T) {
	host := newFakeHost(nil)
	ctx := context.Background()
	p1 := newTestPlugin(t, host)
	payload := map[string]any{
		"task_id":    "task-private",
		"session_id": "session-private",
		"agent_id":   "agent-private",
		"agent_type": "opencode-acp",
		"model":      "open-model",
		"timestamp":  "2026-07-28T12:00:00Z",
		"usage": map[string]any{
			"input_tokens":   float64(10_639),
			"output_tokens":  float64(2),
			"thought_tokens": float64(11),
			"total_tokens":   float64(10_652),
			"estimated":      false,
		},
	}
	require.NoError(t, p1.OnEvent(ctx, &pluginsdk.Event{EventID: "delivery-stable", EventType: "session_prompt_usage.updated.session-private", Payload: payload}))

	// Kandev keeps EventID stable across delivery retries.
	p2 := newTestPlugin(t, host)
	require.NoError(t, p2.OnEvent(ctx, &pluginsdk.Event{EventID: "delivery-stable", EventType: "session_prompt_usage.updated.session-private", Payload: payload}))
	resp, err := p2.HandleWebhook(ctx, &pluginsdk.WebhookRequest{WebhookKey: webhookKeyKandy, Method: "GET"})
	require.NoError(t, err)
	var body map[string]any
	require.NoError(t, json.Unmarshal(resp.Body, &body))
	vault := body["token_vault"].(map[string]any)
	require.Equal(t, "10652", vault["total_tokens"])
}

func TestTokenVault_IdenticalUsageWithDistinctDeliveryIDsCountsTwice(t *testing.T) {
	host := newFakeHost(nil)
	p := newTestPlugin(t, host)
	ctx := context.Background()
	payload := tokenUsageFixture("identical", "codex-acp", "gpt-5.6", 12, time.Date(2026, 7, 28, 12, 0, 0, 0, time.UTC)).Payload

	require.NoError(t, p.OnEvent(ctx, &pluginsdk.Event{EventID: "delivery-one", EventType: "session_prompt_usage.updated.session-identical", Payload: payload}))
	require.NoError(t, p.OnEvent(ctx, &pluginsdk.Event{EventID: "delivery-two", EventType: "session_prompt_usage.updated.session-identical", Payload: payload}))

	require.Equal(t, "24", fetchKandy(t, p, "").TokenVault.TotalTokens)
}

func TestTokenVault_UnusableUsageMarksEmptyVaultPartial(t *testing.T) {
	host := newFakeHost(nil)
	p := newTestPlugin(t, host)
	event := tokenUsageFixture("missing", "codex-acp", "gpt-5.6", 12, time.Date(2026, 7, 28, 12, 0, 0, 0, time.UTC))
	delete(event.Payload, "usage")

	require.NoError(t, p.OnEvent(context.Background(), event))
	vault := fetchKandy(t, p, "").TokenVault
	require.Equal(t, "partial", vault.Status)
	require.Equal(t, "0", vault.TotalTokens)
	require.Empty(t, vault.Rooms)
	require.Equal(t, "2026-07-28T12:00:00Z", vault.ObservedSince)
}

func TestTokenVault_OutOfOrderUsagePreservesEarliestObservedTimestamp(t *testing.T) {
	host := newFakeHost(nil)
	p := newTestPlugin(t, host)
	ctx := context.Background()

	recent := tokenUsageFixture("recent", "codex-acp", "gpt-5.6", 10, time.Date(2026, 7, 28, 12, 1, 0, 0, time.UTC))
	earlier := tokenUsageFixture("earlier", "codex-acp", "gpt-5.6", 20, time.Date(2026, 7, 28, 12, 0, 0, 0, time.UTC))
	require.NoError(t, p.OnEvent(ctx, recent))
	require.NoError(t, p.OnEvent(ctx, earlier))

	vault := fetchKandy(t, p, "").TokenVault
	require.Equal(t, "2026-07-28T12:00:00Z", vault.ObservedSince)
	require.Equal(t, "30", vault.TotalTokens)
}

func TestTokenVault_ModelLastSeenTracksNewestObservationOnly(t *testing.T) {
	host := newFakeHost(nil)
	p := newTestPlugin(t, host)
	ctx := context.Background()

	first := tokenUsageFixture("first", "codex-acp", "gpt-5.6", 10, time.Date(2026, 7, 28, 12, 0, 0, 0, time.UTC))
	newest := tokenUsageFixture("newest", "codex-acp", "gpt-5.6", 10, time.Date(2026, 7, 30, 9, 0, 0, 0, time.UTC))
	late := tokenUsageFixture("late", "codex-acp", "gpt-5.6", 10, time.Date(2026, 7, 29, 9, 0, 0, 0, time.UTC))
	other := tokenUsageFixture("other", "codex-acp", "gpt-5.6-mini", 5, time.Date(2026, 7, 31, 8, 0, 0, 0, time.UTC))
	for _, event := range []*pluginsdk.Event{first, newest, late, other} {
		require.NoError(t, p.OnEvent(ctx, event))
	}

	rooms := fetchKandy(t, p, "").TokenVault.Rooms
	require.Len(t, rooms, 1)
	models := map[string]tokenVaultModelResponse{}
	for _, model := range rooms[0].Models {
		models[model.Name] = model
	}
	// A late delivery of an older turn must not drag the stamp backwards.
	require.Equal(t, "2026-07-30T09:00:00Z", models["gpt-5.6"].LastSeen)
	require.Equal(t, "30", models["gpt-5.6"].Tokens)
	// A small but recent model keeps its own, newer stamp.
	require.Equal(t, "2026-07-31T08:00:00Z", models["gpt-5.6-mini"].LastSeen)
}

func TestTokenVault_LedgerWithoutLastSeenStaysSealedAndKeepsCounting(t *testing.T) {
	host := newFakeHost(nil)
	ctx := context.Background()
	p1 := newTestPlugin(t, host)
	require.NoError(t, p1.OnEvent(ctx, tokenUsageFixture("legacy", "codex-acp", "gpt-5.6", 40, time.Date(2026, 7, 28, 12, 0, 0, 0, time.UTC))))

	// Rewrite the ledger the way a build without this field would have left it:
	// no stamp, and sealed over those bytes. The stamp is omitted when empty,
	// so such a ledger still verifies here instead of restarting the history.
	stored := host.state[stateMapKey(stateScope, "", tokenVaultStateKey)]
	require.NotNil(t, stored)
	legacy, ok := tokenVaultFromMap(stored)
	require.True(t, ok)
	for i := range legacy.Rooms {
		for j := range legacy.Rooms[i].Models {
			legacy.Rooms[i].Models[j].LastSeen = ""
		}
	}
	key, _, err := p1.ensureSealKey(ctx, host)
	require.NoError(t, err)
	sealTokenVault(legacy, key)
	host.state[stateMapKey(stateScope, "", tokenVaultStateKey)] = tokenVaultToMap(legacy)

	p2 := newTestPlugin(t, host)
	vault := fetchKandy(t, p2, "").TokenVault
	require.Equal(t, "40", vault.TotalTokens, "an unstamped ledger stays valid instead of restarting")
	require.Empty(t, vault.Rooms[0].Models[0].LastSeen)

	require.NoError(t, p2.OnEvent(ctx, tokenUsageFixture("fresh", "codex-acp", "gpt-5.6", 2, time.Date(2026, 8, 1, 10, 0, 0, 0, time.UTC))))
	vault = fetchKandy(t, p2, "").TokenVault
	require.Equal(t, "42", vault.TotalTokens)
	require.Equal(t, "2026-08-01T10:00:00Z", vault.Rooms[0].Models[0].LastSeen, "the next observation stamps it")
}

func TestTokenVault_ReadFailureDoesNotOverwriteHistory(t *testing.T) {
	host := newFakeHost(nil)
	ctx := context.Background()
	p1 := newTestPlugin(t, host)
	recorded := tokenUsageFixture("recorded", "codex-acp", "gpt-5.6", 100, time.Date(2026, 7, 28, 12, 0, 0, 0, time.UTC))
	retryLater := tokenUsageFixture("retry-later", "codex-acp", "gpt-5.6", 25, time.Date(2026, 7, 28, 12, 1, 0, 0, time.UTC))
	require.NoError(t, p1.OnEvent(ctx, recorded))

	host.getStateErr[stateMapKey(stateScope, "", tokenVaultStateKey)] = fmt.Errorf("temporary host read failure")
	p2 := newTestPlugin(t, host)
	require.NoError(t, p2.OnEvent(ctx, retryLater))
	delete(host.getStateErr, stateMapKey(stateScope, "", tokenVaultStateKey))

	p3 := newTestPlugin(t, host)
	require.Equal(t, "100", fetchKandy(t, p3, "").TokenVault.TotalTokens, "failed read must not replace stored lifetime history")
}

func TestTokenVault_WriteRetryHandlesKnownAndAmbiguousFailure(t *testing.T) {
	for _, testCase := range []struct {
		name      string
		configure func(*fakeHost, string)
	}{
		{
			name: "known failure",
			configure: func(host *fakeHost, key string) {
				host.setStateErr[key] = fmt.Errorf("write rejected")
			},
		},
		{
			name: "ambiguous commit",
			configure: func(host *fakeHost, key string) {
				host.commitStateErr[key] = fmt.Errorf("response lost after commit")
			},
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			host := newFakeHost(nil)
			ctx := context.Background()
			p := newTestPlugin(t, host)
			event := tokenUsageFixture("write-retry", "claude-acp", "sonnet", 33, time.Date(2026, 7, 28, 12, 0, 0, 0, time.UTC))
			key := stateMapKey(stateScope, "", tokenVaultStateKey)
			testCase.configure(host, key)
			require.NoError(t, p.OnEvent(ctx, event))
			delete(host.setStateErr, key)
			delete(host.commitStateErr, key)

			require.NoError(t, p.OnEvent(ctx, event))
			require.Equal(t, "33", fetchKandy(t, newTestPlugin(t, host), "").TokenVault.TotalTokens)
		})
	}
}

func TestTokenVault_UnknownSchemaStartsFreshHistory(t *testing.T) {
	host := newFakeHost(nil)
	ctx := context.Background()
	p1 := newTestPlugin(t, host)
	require.NoError(t, p1.OnEvent(ctx, tokenUsageFixture("old-schema", "codex-acp", "old", 100, time.Date(2026, 7, 28, 12, 0, 0, 0, time.UTC))))
	host.state[stateMapKey(stateScope, "", tokenVaultStateKey)]["schema_version"] = float64(999)

	p2 := newTestPlugin(t, host)
	require.NoError(t, p2.OnEvent(ctx, tokenUsageFixture("new-schema", "codex-acp", "new", 7, time.Date(2026, 7, 28, 12, 1, 0, 0, time.UTC))))
	vault := fetchKandy(t, p2, "").TokenVault
	require.Equal(t, "7", vault.TotalTokens)
	require.Equal(t, "new", vault.Rooms[0].Models[0].Name)
}

func TestTokenVault_NewKandyLineageStartsFreshHistory(t *testing.T) {
	host := newFakeHost(nil)
	ctx := context.Background()
	p1 := newTestPlugin(t, host)
	require.NoError(t, p1.OnEvent(ctx, tokenUsageFixture("old-lineage", "codex-acp", "old", 100, time.Date(2026, 7, 28, 12, 0, 0, 0, time.UTC))))
	require.NoError(t, host.DeleteState(ctx, stateScope, "", stateKey))

	p2 := newTestPlugin(t, host)
	p2.saltFunc = func() uint32 { return 99 }
	require.NoError(t, p2.OnEvent(ctx, tokenUsageFixture("new-lineage", "codex-acp", "new", 9, time.Date(2026, 7, 28, 12, 1, 0, 0, time.UTC))))
	vault := fetchKandy(t, p2, "").TokenVault
	require.Equal(t, "9", vault.TotalTokens)
	require.Equal(t, "new", vault.Rooms[0].Models[0].Name)
}

func TestTokenVault_EstimatedFallbackIsMarkedPartial(t *testing.T) {
	host := newFakeHost(nil)
	p := newTestPlugin(t, host)
	event := &pluginsdk.Event{
		EventID:   "delivery-codex",
		EventType: "session_prompt_usage.updated.session-codex",
		Payload: map[string]any{
			"agent_type": "codex-acp",
			"model":      "gpt-5.6-codex",
			"timestamp":  "2026-07-28T12:00:00Z",
			"usage": map[string]any{
				"input_tokens":       float64(10_639),
				"output_tokens":      float64(2),
				"cached_read_tokens": float64(900),
				"thought_tokens":     float64(11),
				"total_tokens":       float64(0),
				"estimated":          true,
			},
		},
	}

	require.NoError(t, p.OnEvent(context.Background(), event))
	resp, err := p.HandleWebhook(context.Background(), &pluginsdk.WebhookRequest{WebhookKey: webhookKeyKandy, Method: "GET"})
	require.NoError(t, err)
	var body map[string]any
	require.NoError(t, json.Unmarshal(resp.Body, &body))
	vault := body["token_vault"].(map[string]any)
	require.Equal(t, "partial", vault["status"])
	require.Equal(t, "10641", vault["total_tokens"], "cache and thought tokens must not be added twice")
}

func TestTokenVault_TamperingRestartsOnlyVault(t *testing.T) {
	host := newFakeHost(nil)
	ctx := context.Background()
	p1 := newTestPlugin(t, host)
	event := &pluginsdk.Event{
		EventID:   "delivery-valid",
		EventType: "session_prompt_usage.updated.session-1",
		Payload: map[string]any{
			"agent_type": "gemini-acp",
			"model":      "gemini-2.5-pro",
			"timestamp":  "2026-07-28T12:00:00Z",
			"usage": map[string]any{
				"input_tokens":  float64(9_796),
				"output_tokens": float64(2),
				"total_tokens":  float64(9_798),
				"estimated":     false,
			},
		},
	}
	require.NoError(t, p1.OnEvent(ctx, event))

	stored := host.state[stateMapKey(stateScope, "", tokenVaultStateKey)]
	require.NotNil(t, stored)
	stored["total_tokens"] = "999999"

	p2 := newTestPlugin(t, host)
	state := fetchKandy(t, p2, "")
	require.False(t, state.Counterfeit, "vault corruption must not mark or rebirth Kandy")
	require.Equal(t, "empty", state.TokenVault.Status)
	require.Equal(t, "0", state.TokenVault.TotalTokens)
}

func TestTokenVault_UnknownUnicodeAgentTypeGetsReadableRoom(t *testing.T) {
	host := newFakeHost(nil)
	p := newTestPlugin(t, host)
	event := &pluginsdk.Event{
		EventID:   "delivery-unicode",
		EventType: "session_prompt_usage.updated.session-unicode",
		Payload: map[string]any{
			"agent_type": "  écho-\u0007acp  ",
			"model":      "  modèle-α\u0000  ",
			"timestamp":  "2026-07-28T12:00:00Z",
			"usage":      map[string]any{"total_tokens": float64(7)},
		},
	}

	require.NoError(t, p.OnEvent(context.Background(), event))
	state := fetchKandy(t, p, "")
	require.Len(t, state.TokenVault.Rooms, 1)
	require.Equal(t, "écho-acp", state.TokenVault.Rooms[0].AgentType)
	require.Equal(t, "Écho Acp", state.TokenVault.Rooms[0].Label)
	require.Equal(t, "modèle-α", state.TokenVault.Rooms[0].Models[0].Name)
}

func TestTokenVault_UsesProductRoomLabels(t *testing.T) {
	for _, test := range []struct {
		agentType string
		label     string
	}{
		{agentType: "claude-acp", label: "Claude Code"},
		{agentType: "codex-acp", label: "Codex"},
		{agentType: "opencode-acp", label: "OpenCode"},
		{agentType: "gemini", label: "Gemini"},
		{agentType: "gemini-acp", label: "Gemini"},
		{agentType: "openai-acp", label: "OpenAI"},
		{agentType: "mystery-agent", label: "Mystery agent"},
		{agentType: "custom_agent", label: "Custom Agent"},
	} {
		t.Run(test.agentType, func(t *testing.T) {
			host := newFakeHost(nil)
			p := newTestPlugin(t, host)
			event := tokenUsageFixture("labels", test.agentType, "model", 1, time.Date(2026, 7, 28, 12, 0, 0, 0, time.UTC))

			require.NoError(t, p.OnEvent(context.Background(), event))
			state := fetchKandy(t, p, "")
			require.Len(t, state.TokenVault.Rooms, 1)
			require.Equal(t, test.agentType, state.TokenVault.Rooms[0].AgentType)
			require.Equal(t, test.label, state.TokenVault.Rooms[0].Label)
		})
	}
}

func TestTokenVault_UsageDoesNotMutateCreatureLedger(t *testing.T) {
	host := newFakeHost(nil)
	p := newTestPlugin(t, host)
	ctx := context.Background()
	require.NoError(t, p.OnEvent(ctx, busEvent(eventTurnCompleted, map[string]any{})))
	before := persistedLedger(t, host)

	base := p.now()
	p.now = func() time.Time { return base.Add(24 * time.Hour) }
	require.NoError(t, p.OnEvent(ctx, &pluginsdk.Event{
		EventID:   "delivery-no-xp",
		EventType: "session_prompt_usage.updated.session-no-xp",
		Payload: map[string]any{
			"agent_type": "claude-acp",
			"model":      "claude-sonnet-4-5",
			"timestamp":  "2026-07-29T12:00:00Z",
			"usage":      map[string]any{"total_tokens": float64(123)},
		},
	}))
	after := persistedLedger(t, host)

	require.Equal(t, before.XP, after.XP)
	require.Equal(t, before.AwardSeq, after.AwardSeq)
	require.Equal(t, before.LastAwardAt, after.LastAwardAt)
	require.Equal(t, before.UpdatedAt, after.UpdatedAt)
}

func TestTokenVault_RetainsEveryAgentAndModelWithExactLifetime(t *testing.T) {
	host := newFakeHost(nil)
	p := newTestPlugin(t, host)
	ctx := context.Background()
	base := time.Date(2026, 7, 28, 12, 0, 0, 0, time.UTC)

	for index, agentType := range []string{"claude-acp", "codex-acp", "opencode-acp"} {
		require.NoError(t, p.OnEvent(ctx, tokenUsageFixture(
			fmt.Sprintf("large-%d", index), agentType, "shared-model", 4_000_000_000_000_000, base.Add(time.Duration(index)*time.Second),
		)))
	}
	for index := 0; index < 40; index++ {
		require.NoError(t, p.OnEvent(ctx, tokenUsageFixture(
			fmt.Sprintf("model-%d", index), "codex-acp", fmt.Sprintf("model-%02d", index), 1, base.Add(time.Duration(index+10)*time.Second),
		)))
	}

	vault := fetchKandy(t, p, "").TokenVault
	require.Equal(t, "12000000000000040", vault.TotalTokens, "lifetime total stays exact above Number.MAX_SAFE_INTEGER")
	require.Len(t, vault.Rooms, 3)
	require.Equal(t, "codex-acp", vault.Rooms[0].AgentType, "largest room sorts first")
	require.Len(t, vault.Rooms[0].Models, 41, "no first-model cap or Other bucket")
	for _, room := range vault.Rooms {
		require.NotEqual(t, "Other", room.Label)
		require.Contains(t, modelNames(room), "shared-model", "same model remains distinct inside every agent room")
	}
}

func TestTokenVault_RepeatedEventsGrowCountsNotAggregateCardinality(t *testing.T) {
	host := newFakeHost(nil)
	p := newTestPlugin(t, host)
	ctx := context.Background()
	base := time.Date(2026, 7, 28, 12, 0, 0, 0, time.UTC)
	for index := 0; index < 1_000; index++ {
		require.NoError(t, p.OnEvent(ctx, tokenUsageFixture(fmt.Sprintf("repeat-%04d", index), "codex-acp", "gpt-5.6", 1, base.Add(time.Duration(index)*time.Second))))
	}

	vault := fetchKandy(t, p, "").TokenVault
	require.Equal(t, "1000", vault.TotalTokens)
	require.Len(t, vault.Rooms, 1)
	require.Len(t, vault.Rooms[0].Models, 1)
}

func TestTokenVault_RecentBodyHashRingIsBoundedFIFO(t *testing.T) {
	host := newFakeHost(nil)
	p := newTestPlugin(t, host)
	ctx := context.Background()
	base := time.Date(2026, 7, 28, 12, 0, 0, 0, time.UTC)
	var first, newest *pluginsdk.Event
	for index := 0; index < tokenVaultDigestLimit+1; index++ {
		event := tokenUsageFixture(fmt.Sprintf("ring-%d", index), "codex-acp", "gpt", 1, base.Add(time.Duration(index)*time.Second))
		if index == 0 {
			first = event
		}
		newest = event
		require.NoError(t, p.OnEvent(ctx, event))
	}
	require.Equal(t, "513", fetchKandy(t, p, "").TokenVault.TotalTokens)
	require.NoError(t, p.OnEvent(ctx, newest))
	require.Equal(t, "513", fetchKandy(t, p, "").TokenVault.TotalTokens, "newest digest remains protected")
	require.NoError(t, p.OnEvent(ctx, first))
	require.Equal(t, "514", fetchKandy(t, p, "").TokenVault.TotalTokens, "oldest digest was evicted first")

	stored := host.state[stateMapKey(stateScope, "", tokenVaultStateKey)]
	hashes, ok := stored["recent_body_hashes"].([]any)
	require.True(t, ok)
	require.Len(t, hashes, tokenVaultDigestLimit)
}

func TestTokenVault_PersistsAndExposesOnlyAggregateMetadata(t *testing.T) {
	host := newFakeHost(nil)
	p := newTestPlugin(t, host)
	ctx := context.Background()
	event := tokenUsageFixture("privacy", "claude-acp", "sonnet", 42, time.Date(2026, 7, 28, 12, 0, 0, 0, time.UTC))
	event.Payload["task_id"] = "PRIVATE_TASK_NEVER_STORE"
	event.Payload["session_id"] = "PRIVATE_SESSION_NEVER_STORE"
	event.Payload["agent_id"] = "PRIVATE_AGENT_NEVER_STORE"
	event.Payload["prompt"] = "PRIVATE_PROMPT_NEVER_STORE"
	event.Payload["usage"].(map[string]any)["provider_reported_cost_subcents"] = float64(99_999)
	require.NoError(t, p.OnEvent(ctx, event))

	storedJSON, err := json.Marshal(host.state[stateMapKey(stateScope, "", tokenVaultStateKey)])
	require.NoError(t, err)
	response, err := p.HandleWebhook(ctx, &pluginsdk.WebhookRequest{WebhookKey: webhookKeyKandy, Method: "GET"})
	require.NoError(t, err)
	for _, forbidden := range []string{
		"PRIVATE_TASK_NEVER_STORE", "PRIVATE_SESSION_NEVER_STORE", "PRIVATE_AGENT_NEVER_STORE", "PRIVATE_PROMPT_NEVER_STORE",
		"provider_reported_cost_subcents", "input_tokens", "output_tokens", "cached_read_tokens", "thought_tokens",
	} {
		require.NotContains(t, string(storedJSON), forbidden)
		require.NotContains(t, string(response.Body), forbidden)
	}
}

func tokenUsageFixture(id, agentType, model string, tokens int64, timestamp time.Time) *pluginsdk.Event {
	return &pluginsdk.Event{
		EventID:   "delivery-" + id,
		EventType: "session_prompt_usage.updated.session-" + id,
		Payload: map[string]any{
			"task_id":    "task-" + id,
			"session_id": "session-" + id,
			"agent_id":   "agent-" + id,
			"agent_type": agentType,
			"model":      model,
			"timestamp":  timestamp.UTC().Format(time.RFC3339),
			"usage":      map[string]any{"total_tokens": float64(tokens), "estimated": false},
		},
	}
}

func modelNames(room tokenVaultRoomResponse) string {
	names := make([]string, 0, len(room.Models))
	for _, model := range room.Models {
		names = append(names, model.Name)
	}
	return strings.Join(names, "\n")
}
