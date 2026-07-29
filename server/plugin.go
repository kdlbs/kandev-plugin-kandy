// Package main is the backend of the Shipling plugin. It owns the
// entire XP model: OnEvent turns work signals from the kandev bus into
// lifetime XP persisted through Host state, and the single "shipling" webhook
// serves the presentation-only view (level, stage name, progress, seed) the
// UI renders. The factor weights below are deliberately never exposed.
package main

import (
	"context"
	"encoding/json"
	"log"
	"math"
	"math/rand"
	"net/url"
	"strconv"
	"sync"
	"time"

	"github.com/kandev/kandev/pkg/pluginsdk"
)

const (
	webhookKeyShipling = "shipling"

	stateScope = "instance" // one shipling per kandev instance
	stateKey   = "shipling"

	configKeyDebug = "debug"

	// Hidden XP recipe. The UI and webhook never itemize these.
	xpMessageAdded   = 1.0
	xpTurnCompleted  = 8.0
	xpAgentCompleted = 20.0
	xpTaskCompleted  = 150.0

	// debugGrantMax bounds the dev/demo XP knob to something that cannot
	// overflow the math even if mashed repeatedly.
	debugGrantMax = int64(1_000_000_000)
)

// Bus subjects this plugin subscribes to (mirrors manifest.yaml).
const (
	eventMessageAdded     = "message.added"
	eventTurnCompleted    = "turn.completed"
	eventAgentCompleted   = "agent.completed"
	eventTaskStateChanged = "task.state_changed"
	eventTaskUpdated      = "task.updated"

	taskStateCompleted = "COMPLETED"

	// maxAwardedTasks bounds the once-per-task completion ledger (a ring:
	// oldest ids fall off). ~500 covers two months at the measured ~8.4
	// archived tasks/active day.
	maxAwardedTasks = 500
)

// ledger is the whole persisted shipling: lifetime XP plus private counters.
// It round-trips through Host state as a JSON object.
type ledger struct {
	XP        float64 `json:"xp"`
	Messages  int64   `json:"messages"`
	Turns     int64   `json:"turns"`
	AgentRuns int64   `json:"agent_runs"`
	TasksDone int64   `json:"tasks_done"`
	// Salt is the instance's lineage: chosen randomly once, it makes two
	// instances at the same level look different, forever.
	Salt      uint32 `json:"salt"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
	// AwardedTasks is a bounded ring of task ids that already received
	// completion XP — a task never awards twice, whether it completes,
	// archives, or both. (In real production use tasks end at REVIEW and
	// get archived; new_state=="COMPLETED" never fires there.)
	AwardedTasks []string `json:"awarded_tasks,omitempty"`
	// AwardSeq increments on every XP award — the UI's "gained since last
	// fetch" signal that never exposes the hidden XP magnitude.
	AwardSeq int64 `json:"award_seq,omitempty"`
	// LastAwardAt (RFC3339) feeds the mood: how long since the shipling
	// was last fed. Missing on pre-0.6 state: presentLedger falls back to
	// UpdatedAt (every award touched it), never to "ancient".
	LastAwardAt string `json:"last_award_at,omitempty"`
}

func (l *ledger) hasAwardedTask(taskID string) bool {
	for _, id := range l.AwardedTasks {
		if id == taskID {
			return true
		}
	}
	return false
}

func (l *ledger) markTaskAwarded(taskID string) {
	l.AwardedTasks = append(l.AwardedTasks, taskID)
	if len(l.AwardedTasks) > maxAwardedTasks {
		l.AwardedTasks = l.AwardedTasks[len(l.AwardedTasks)-maxAwardedTasks:]
	}
}

// shiplingResponse is everything the UI is allowed to know. Archetype,
// family, biome and lineage_seed are the lineage DNA (constant for the
// install's lifetime); level/stage drive the additive growth.
type shiplingResponse struct {
	Level          int     `json:"level"`
	Stage          int     `json:"stage"` // metamorphosis stage 0..4
	Archetype      int     `json:"archetype"`
	Family         int     `json:"family"`
	Biome          int     `json:"biome"`
	LineageSeed    uint32  `json:"lineage_seed"`
	StageName      string  `json:"stage_name"`
	ProgressPct    float64 `json:"progress_pct"`
	AppearanceSeed uint32  `json:"appearance_seed"`
	// Mood is derived from time since the last XP award; AwardSeq lets the
	// UI detect "gained since last fetch" without exposing XP magnitudes.
	Mood        string `json:"mood"`
	AwardSeq    int64  `json:"award_seq"`
	LastAwardAt string `json:"last_award_at,omitempty"`
	Flavor      string `json:"flavor"`
	AliveSince  string `json:"alive_since"`
}

type plugin struct {
	pluginsdk.UnimplementedPlugin

	// mu guards cached: OnEvent deliveries are sequential per plugin, but a
	// webhook debug_grant can race an event delivery.
	mu     sync.Mutex
	cached *ledger

	// Seams injected for tests; production values set in newPlugin.
	now      func() time.Time
	saltFunc func() uint32
}

func newPlugin() *plugin {
	return &plugin{
		now:      time.Now,
		saltFunc: rand.Uint32,
	}
}

// loadLedger returns the current ledger, reading it through Host state on
// first use (and creating a fresh egg when none is persisted yet). Callers
// must hold p.mu.
func (p *plugin) loadLedger(ctx context.Context) *ledger {
	if p.cached != nil {
		return p.cached
	}
	fresh := &ledger{
		Salt:      p.saltFunc(),
		CreatedAt: p.now().UTC().Format(time.RFC3339),
		UpdatedAt: p.now().UTC().Format(time.RFC3339),
	}
	host := p.Host()
	if host == nil {
		// Host broker not connected yet: serve a transient egg but do not
		// cache it, so the persisted ledger wins once the Host arrives.
		return fresh
	}
	value, found, err := host.GetState(ctx, stateScope, "", stateKey)
	if err != nil {
		log.Printf("shipling: reading state: %v", err)
		return fresh
	}
	if found {
		p.cached = ledgerFromMap(value)
	} else {
		p.cached = fresh
	}
	return p.cached
}

// mutateLedger applies fn to the ledger and persists the result. Returns
// the ledger actually served (persisted or best-effort). Callers must hold
// p.mu.
func (p *plugin) mutateLedger(ctx context.Context, fn func(*ledger)) *ledger {
	l := p.loadLedger(ctx)
	fn(l)
	l.UpdatedAt = p.now().UTC().Format(time.RFC3339)
	host := p.Host()
	if host == nil {
		return l
	}
	if err := host.SetState(ctx, stateScope, "", stateKey, ledgerToMap(l)); err != nil {
		log.Printf("shipling: persisting state: %v", err)
	}
	return l
}

// awardXP is mutateLedger plus the per-award bookkeeping (sequence bump +
// last-award timestamp for the mood). Callers must hold p.mu.
func (p *plugin) awardXP(ctx context.Context, apply func(*ledger)) *ledger {
	return p.mutateLedger(ctx, func(l *ledger) {
		apply(l)
		l.AwardSeq++
		l.LastAwardAt = p.now().UTC().Format(time.RFC3339)
	})
}

// OnEvent feeds the shipling. It always returns nil — kandev retries
// deliveries on error with the same EventID, and a retried delivery of an
// already-counted event would farm duplicate XP — so parse failures and
// state hiccups are logged and swallowed.
func (p *plugin) OnEvent(ctx context.Context, e *pluginsdk.Event) error {
	if e == nil {
		return nil
	}
	if taskID, done := taskCompletionFromEvent(e); done {
		p.awardTaskCompletion(ctx, taskID)
		return nil
	}
	delta, apply := xpForEvent(e)
	if delta <= 0 {
		return nil
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	p.awardXP(ctx, func(l *ledger) {
		l.XP += delta
		apply(l)
	})
	return nil
}

// taskCompletionFromEvent reports whether the event marks a task as
// finished, covering both real-world endings:
//   - task.state_changed with new_state == "COMPLETED" (workflows that end
//     in a COMPLETED state), and
//   - task.updated with archived_at set (the measured production flow:
//     tasks end at REVIEW and are archived — COMPLETED never fires there).
//
// A task id is required so the once-per-task guard can hold across both
// paths; malformed payloads award nothing.
func taskCompletionFromEvent(e *pluginsdk.Event) (string, bool) {
	taskID, _ := e.Payload["task_id"].(string)
	if taskID == "" {
		return "", false
	}
	switch e.EventType {
	case eventTaskStateChanged:
		newState, _ := e.Payload["new_state"].(string)
		return taskID, newState == taskStateCompleted
	case eventTaskUpdated:
		archivedAt, _ := e.Payload["archived_at"].(string)
		return taskID, archivedAt != ""
	default:
		return "", false
	}
}

// awardTaskCompletion grants the big task XP exactly once per task id,
// whether the task completed, archived, or both (retries and repeated
// task.updated deliveries included).
func (p *plugin) awardTaskCompletion(ctx context.Context, taskID string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.loadLedger(ctx).hasAwardedTask(taskID) {
		return
	}
	p.awardXP(ctx, func(l *ledger) {
		l.XP += xpTaskCompleted
		l.TasksDone++
		l.markTaskAwarded(taskID)
	})
}

// xpForEvent maps a per-activity bus event to its XP award and counter
// bump. Unknown subjects award nothing (task completion is handled by
// taskCompletionFromEvent above).
func xpForEvent(e *pluginsdk.Event) (float64, func(*ledger)) {
	switch e.EventType {
	case eventMessageAdded:
		return xpMessageAdded, func(l *ledger) { l.Messages++ }
	case eventTurnCompleted:
		return xpTurnCompleted, func(l *ledger) { l.Turns++ }
	case eventAgentCompleted:
		return xpAgentCompleted, func(l *ledger) { l.AgentRuns++ }
	default:
		return 0, nil
	}
}

func (p *plugin) HandleWebhook(ctx context.Context, req *pluginsdk.WebhookRequest) (*pluginsdk.WebhookResponse, error) {
	if req.WebhookKey != webhookKeyShipling {
		return jsonResponse(404, []byte(`{"error":"unknown webhook"}`)), nil
	}
	query, err := url.ParseQuery(req.Query)
	if err != nil {
		query = url.Values{}
	}

	p.mu.Lock()
	defer p.mu.Unlock()

	if grant := query.Get("debug_grant"); grant != "" {
		if resp := p.applyDebugGrant(ctx, grant); resp != nil {
			return resp, nil
		}
	}
	var idleOverride *time.Duration
	if raw := query.Get("debug_idle_hours"); raw != "" {
		override, errResp := p.parseDebugIdleHours(ctx, raw)
		if errResp != nil {
			return errResp, nil
		}
		idleOverride = override
	}

	l := p.loadLedger(ctx)
	body, err := json.Marshal(p.presentLedger(l, idleOverride))
	if err != nil {
		return jsonResponse(500, []byte(`{"error":"encoding state"}`)), nil
	}
	return jsonResponse(200, body), nil
}

// applyDebugGrant handles the ?debug_grant dev/demo knob. It grants XP only
// when the operator flipped the plugin's `debug` config on; otherwise it
// short-circuits with an error response (non-nil return means "reply with
// this instead of the normal payload"). Callers must hold p.mu.
func (p *plugin) applyDebugGrant(ctx context.Context, grant string) *pluginsdk.WebhookResponse {
	if !p.debugEnabled(ctx) {
		return jsonResponse(403, []byte(`{"error":"debug mode disabled"}`))
	}
	n, err := strconv.ParseInt(grant, 10, 64)
	if err != nil || n <= 0 || n > debugGrantMax {
		return jsonResponse(400, []byte(`{"error":"debug_grant must be an integer in 1..1000000000"}`))
	}
	p.awardXP(ctx, func(l *ledger) { l.XP += float64(n) })
	return nil
}

// parseDebugIdleHours handles the ?debug_idle_hours dev/demo knob: an
// override for the mood's idle duration (so sadness states can be demoed
// without waiting days). Debug-gated exactly like debug_grant. Returns
// (override, errorResponse).
func (p *plugin) parseDebugIdleHours(ctx context.Context, raw string) (*time.Duration, *pluginsdk.WebhookResponse) {
	if !p.debugEnabled(ctx) {
		return nil, jsonResponse(403, []byte(`{"error":"debug mode disabled"}`))
	}
	hours, err := strconv.ParseFloat(raw, 64)
	if err != nil || math.IsNaN(hours) || math.IsInf(hours, 0) || hours < 0 || hours > 1e6 {
		return nil, jsonResponse(400, []byte(`{"error":"debug_idle_hours must be a number in 0..1000000"}`))
	}
	d := time.Duration(hours * float64(time.Hour))
	return &d, nil
}

func (p *plugin) debugEnabled(ctx context.Context) bool {
	host := p.Host()
	if host == nil {
		return false
	}
	config, err := host.GetConfig(ctx)
	if err != nil {
		log.Printf("shipling: reading config: %v", err)
		return false
	}
	enabled, _ := config[configKeyDebug].(bool)
	return enabled
}

// sinceLastAward computes how long ago the shipling was last fed.
// Migration-safe: pre-0.6 state has no last_award_at, so fall back to
// updated_at (every award touched it); a fully unknown timestamp counts as
// "just now" — never as ancient.
func (p *plugin) sinceLastAward(l *ledger) time.Duration {
	for _, stamp := range []string{l.LastAwardAt, l.UpdatedAt} {
		if t, err := time.Parse(time.RFC3339, stamp); err == nil {
			return p.now().UTC().Sub(t)
		}
	}
	return 0
}

// presentLedger converts the private ledger into the public presentation.
// This is the only place webhook output is built — counters and weights
// never cross this boundary. idleOverride (debug-only) replaces the
// computed time-since-award for mood/flavor.
func (p *plugin) presentLedger(l *ledger, idleOverride *time.Duration) shiplingResponse {
	level := levelForXP(l.XP)
	sinceAward := p.sinceLastAward(l)
	if idleOverride != nil {
		sinceAward = *idleOverride
	}
	mood := moodFor(sinceAward)
	return shiplingResponse{
		Level:          level,
		Stage:          stageForLevel(level),
		Archetype:      archetypeForLineage(l.Salt),
		Family:         paletteFamilyForLineage(l.Salt),
		Biome:          biomeForLineage(l.Salt),
		LineageSeed:    lineageSeed(l.Salt),
		StageName:      stageName(l.Salt, level),
		ProgressPct:    roundDownToTenth(progressPct(l.XP)),
		AppearanceSeed: appearanceSeed(l.Salt, level),
		Mood:           mood,
		AwardSeq:       l.AwardSeq,
		LastAwardAt:    l.LastAwardAt,
		Flavor:         flavorText(l.Salt, level, mood),
		AliveSince:     l.CreatedAt,
	}
}

// ledgerToMap / ledgerFromMap round-trip the ledger through the JSON-object
// shape Host state stores (structpb only carries float64 numbers).
func ledgerToMap(l *ledger) map[string]any {
	raw, err := json.Marshal(l)
	if err != nil {
		return map[string]any{}
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		return map[string]any{}
	}
	return m
}

func ledgerFromMap(m map[string]any) *ledger {
	l := &ledger{}
	raw, err := json.Marshal(m)
	if err != nil {
		return l
	}
	if err := json.Unmarshal(raw, l); err != nil {
		return &ledger{}
	}
	return l
}

// jsonResponse marks every reply no-store: the shipling's level and XP change
// as work lands, so a cached body would show a stale creature until reload.
func jsonResponse(status int32, body []byte) *pluginsdk.WebhookResponse {
	return &pluginsdk.WebhookResponse{
		Status: status,
		Headers: map[string]string{
			"Content-Type":  "application/json",
			"Cache-Control": "no-store",
		},
		Body: body,
	}
}
