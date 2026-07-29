// Package main is the backend of the Kandy plugin. It owns the
// entire XP model: OnEvent turns work signals from the kandev bus into
// lifetime XP persisted through Host state, and the single "kandy" webhook
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
	webhookKeyKandy = "kandy"
	webhookKeyPet   = "pet"
	webhookKeyBonk  = "bonk"

	stateScope = "instance" // one kandy per kandev instance
	stateKey   = "kandy"

	configKeyDebug = "debug"

	// Hidden XP recipe. The UI and webhook never itemize these. Only
	// agent activity feeds the kandy — task lifecycle events are excluded
	// on purpose (archiving a freshly created task is free, agent work
	// is not).
	xpMessageAdded   = 1.0
	xpTurnCompleted  = 8.0
	xpAgentCompleted = 20.0

	// debugGrantMax bounds the dev/demo XP knob to something that cannot
	// overflow the math even if mashed repeatedly.
	debugGrantMax = int64(1_000_000_000)
)

// Bus subjects this plugin subscribes to (mirrors manifest.yaml).
const (
	eventMessageAdded   = "message.added"
	eventTurnCompleted  = "turn.completed"
	eventAgentCompleted = "agent.completed"
)

// ledger is the whole persisted kandy: lifetime XP plus private counters.
// It round-trips through Host state as a JSON object.
type ledger struct {
	XP        float64 `json:"xp"`
	Messages  int64   `json:"messages"`
	Turns     int64   `json:"turns"`
	AgentRuns int64   `json:"agent_runs"`
	// Salt is the instance's lineage: chosen randomly once, it makes two
	// instances at the same level look different, forever.
	Salt      uint32 `json:"salt"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
	// AwardSeq increments on every XP award — the UI's "gained since last
	// fetch" signal that never exposes the hidden XP magnitude.
	AwardSeq int64 `json:"award_seq,omitempty"`
	// LastAwardAt (RFC3339) feeds the mood: how long since the kandy
	// was last fed. Missing on pre-0.6 state: presentLedger falls back to
	// UpdatedAt (every award touched it), never to "ancient".
	LastAwardAt string `json:"last_award_at,omitempty"`
	// LastPettedAt (RFC3339): petting briefly lifts the displayed mood
	// (one tier, capped at happy, for petLiftWindow). It never touches XP.
	LastPettedAt string `json:"last_petted_at,omitempty"`
	// Care system (v0.3.0): pets and bonks shape a persistent temperament
	// in [-100, +100] that conditions presentation only — see
	// temperament.go for the constants and invariants. None of these
	// fields may ever influence XP, level, award_seq or last_award_at.
	PetsGiven   int64   `json:"pets_given,omitempty"`
	BonksGiven  int64   `json:"bonks_given,omitempty"`
	Temperament float64 `json:"temperament,omitempty"`
	// Scarred latches true forever once temperament reaches scarThreshold.
	Scarred bool `json:"scarred,omitempty"`
	// LastBonkedAt (RFC3339) drives the distrust window (pets refused),
	// the 30min displayed-mood drop, and the bonk-effect rate limit.
	LastBonkedAt string `json:"last_bonked_at,omitempty"`
	// LastPetEffectAt (RFC3339) rate-limits pets' temperament effect.
	LastPetEffectAt string `json:"last_pet_effect_at,omitempty"`
}

// kandyResponse is everything the UI is allowed to know. Archetype,
// family, biome and lineage_seed are the lineage DNA (constant for the
// install's lifetime); level/stage drive the additive growth.
type kandyResponse struct {
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
	// TemperamentBand is the ONLY temperament shape the UI ever sees —
	// never the raw score. Scarred and RefusingPets condition rendering
	// and the pet interaction respectively.
	TemperamentBand string `json:"temperament_band"`
	Scarred         bool   `json:"scarred"`
	RefusingPets    bool   `json:"refusing_pets"`
	Flavor          string `json:"flavor"`
	AliveSince      string `json:"alive_since"`
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
		log.Printf("kandy: reading state: %v", err)
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
		log.Printf("kandy: persisting state: %v", err)
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

// OnEvent feeds the kandy. It always returns nil — kandev retries
// deliveries on error with the same EventID, and a retried delivery of an
// already-counted event would farm duplicate XP — so parse failures and
// state hiccups are logged and swallowed.
func (p *plugin) OnEvent(ctx context.Context, e *pluginsdk.Event) error {
	if e == nil {
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

// xpForEvent maps a per-activity bus event to its XP award and counter
// bump. Unknown subjects award nothing. There is deliberately NO XP for
// task completion/archival: creating and archiving a task is free and
// repeatable, so it was an abuse vector — agent activity (turns, runs,
// messages) costs real work and is the only food the kandy accepts.
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
	if req.WebhookKey == webhookKeyPet {
		return p.handlePet(ctx), nil
	}
	if req.WebhookKey == webhookKeyBonk {
		return p.handleBonk(ctx), nil
	}
	if req.WebhookKey != webhookKeyKandy {
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

// handlePet stamps last_petted_at and returns the (possibly mood-lifted)
// presentation. Deliberately NOT debug-gated, unlike debug_grant: petting
// is a harmless presentational stamp — it cannot change XP, level,
// progress, or the award sequence, and the lift is one tier, capped at
// "happy", expiring after an hour. Worst case an anonymous caller makes
// the creature look slightly less sad for a while.
func (p *plugin) handlePet(ctx context.Context) *pluginsdk.WebhookResponse {
	p.mu.Lock()
	defer p.mu.Unlock()
	l := p.loadLedger(ctx)
	// Distrust: freshly bonked, the kandy refuses pets entirely — no
	// stamp, no lift, no temperament change. The UI mirrors this with a
	// turn-away reaction.
	if p.within(l.LastBonkedAt, distrustWindow) {
		view := p.presentLedger(l, nil)
		view.Flavor = "It doesn't trust you right now."
		return presentResponse(view)
	}
	// Plain mutateLedger, not awardXP: no XP, no award_seq bump, no
	// last_award_at change. The temperament effect is rate-limited to one
	// per petEffectWindow, gains nothing within careCalmWindow of a bonk,
	// and heals negative scores at only petHealGain (see temperament.go).
	l = p.mutateLedger(ctx, func(l *ledger) {
		l.PetsGiven++
		l.LastPettedAt = p.now().UTC().Format(time.RFC3339)
		if p.within(l.LastPetEffectAt, petEffectWindow) || p.within(l.LastBonkedAt, careCalmWindow) {
			return
		}
		gain := petTemperamentGain
		if l.Temperament < 0 {
			gain = petHealGain
		}
		l.Temperament = clampTemperament(l.Temperament + gain)
		l.LastPetEffectAt = p.now().UTC().Format(time.RFC3339)
	})
	return presentResponse(p.presentLedger(l, nil))
}

// handleBonk dumps a bucket of cold water on the kandy. Like petting it never touches
// XP/level/award_seq — but unlike petting it pushes the persistent
// temperament DOWN (rate-limited to one effect per bonkEffectWindow; the
// stamp always refreshes, so spamming keeps resetting the window instead
// of stacking trauma), cancels any active pet lift, drops the displayed
// mood one tier for bonkMoodWindow, and opens the distrust window.
func (p *plugin) handleBonk(ctx context.Context) *pluginsdk.WebhookResponse {
	p.mu.Lock()
	defer p.mu.Unlock()
	l := p.mutateLedger(ctx, func(l *ledger) {
		l.BonksGiven++
		if !p.within(l.LastBonkedAt, bonkEffectWindow) {
			l.Temperament = clampTemperament(l.Temperament - bonkTemperamentDelta)
			if l.Temperament <= scarThreshold {
				l.Scarred = true // permanent — never cleared
			}
		}
		l.LastBonkedAt = p.now().UTC().Format(time.RFC3339)
		l.LastPettedAt = "" // a bonk cancels any active pet lift
	})
	view := p.presentLedger(l, nil)
	view.Flavor = "Your kandy got drenched."
	return presentResponse(view)
}

func presentResponse(view kandyResponse) *pluginsdk.WebhookResponse {
	body, err := json.Marshal(view)
	if err != nil {
		return jsonResponse(500, []byte(`{"error":"encoding state"}`))
	}
	return jsonResponse(200, body)
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
		log.Printf("kandy: reading config: %v", err)
		return false
	}
	enabled, _ := config[configKeyDebug].(bool)
	return enabled
}

// within reports whether the RFC3339 stamp is less than window old. An
// empty or unparsable stamp is never "within" anything.
func (p *plugin) within(stamp string, window time.Duration) bool {
	t, err := time.Parse(time.RFC3339, stamp)
	return err == nil && p.now().UTC().Sub(t) < window
}

// sinceLastAward computes how long ago the kandy was last fed.
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
func (p *plugin) presentLedger(l *ledger, idleOverride *time.Duration) kandyResponse {
	level := levelForXP(l.XP)
	sinceAward := p.sinceLastAward(l)
	if idleOverride != nil {
		sinceAward = *idleOverride
	}
	mood := moodFor(sinceAward)
	flavor := flavorText(l.Salt, level, mood)
	// A recent petting lifts the displayed mood one tier (capped at happy)
	// — presentational only; the base mood keeps decaying from
	// last_award_at underneath.
	if p.within(l.LastPettedAt, petLiftWindow) {
		if lifted := liftMood(mood); lifted != mood {
			mood = lifted
			flavor = "Your kandy purrs — but it's still hungry for shipped work."
		}
	}
	// A recent bonk drops the displayed mood one tier for bonkMoodWindow.
	// (Any pet lift active at bonk time was cancelled by the bonk handler;
	// a post-distrust pet's lift and this drop simply cancel out.)
	if p.within(l.LastBonkedAt, bonkMoodWindow) {
		mood = lowerMood(mood)
	}
	// Band flavor: trauma dominates the idle/mood lines; adoration only
	// speaks up when nothing more urgent (hunger, purring) is on screen.
	band := temperamentBand(l.Temperament)
	if level > 1 {
		switch band {
		case "fearful":
			flavor = "Your kandy trembles when you reach out."
		case "wary":
			flavor = "Your kandy watches your hands warily."
		case "beloved":
			if mood == "content" {
				flavor = "Your kandy adores you."
			}
		}
	}
	return kandyResponse{
		Level:           level,
		Stage:           stageForLevel(level),
		Archetype:       archetypeForLineage(l.Salt),
		Family:          paletteFamilyForLineage(l.Salt),
		Biome:           biomeForLineage(l.Salt),
		LineageSeed:     lineageSeed(l.Salt),
		StageName:       stageName(l.Salt, level),
		ProgressPct:     roundDownToTenth(progressPct(l.XP)),
		AppearanceSeed:  appearanceSeed(l.Salt, level),
		Mood:            mood,
		AwardSeq:        l.AwardSeq,
		LastAwardAt:     l.LastAwardAt,
		TemperamentBand: band,
		Scarred:         l.Scarred,
		RefusingPets:    p.within(l.LastBonkedAt, distrustWindow),
		Flavor:          flavor,
		AliveSince:      l.CreatedAt,
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

// jsonResponse marks every reply no-store: the kandy's level and XP change
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
