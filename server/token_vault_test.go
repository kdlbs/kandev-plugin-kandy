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
