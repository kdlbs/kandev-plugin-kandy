package main

import (
	"context"
	"encoding/json"
	"testing"

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
				"label":      "Claude",
				"tokens":     "25068",
				"models": []any{
					map[string]any{"name": "claude-sonnet-4-5", "tokens": "25068"},
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
	require.Equal(t, "empty", vault["status"])
	require.Equal(t, "0", vault["total_tokens"])
}

func TestTokenVault_DuplicateBodyCountsOnceAcrossRestart(t *testing.T) {
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
	require.NoError(t, p1.OnEvent(ctx, &pluginsdk.Event{
		EventID: "delivery-original", EventType: "session_prompt_usage.updated.session-private", Payload: payload,
	}))

	// A producer republication can receive another delivery ID. The stable
	// normalized body, not transport identity, is the practical dedupe seam.
	p2 := newTestPlugin(t, host)
	require.NoError(t, p2.OnEvent(ctx, &pluginsdk.Event{
		EventID: "delivery-republished", EventType: "session_prompt_usage.updated.session-private", Payload: payload,
	}))
	resp, err := p2.HandleWebhook(ctx, &pluginsdk.WebhookRequest{WebhookKey: webhookKeyKandy, Method: "GET"})
	require.NoError(t, err)
	var body map[string]any
	require.NoError(t, json.Unmarshal(resp.Body, &body))
	vault := body["token_vault"].(map[string]any)
	require.Equal(t, "10652", vault["total_tokens"])
}
