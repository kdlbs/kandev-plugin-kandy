// Package main is the backend of the Kandy plugin. It owns the
// entire XP model: OnEvent turns work signals from the kandev bus into
// lifetime XP persisted through Host state, and the single "kandy" webhook
// serves the presentation-only view (level, stage name, progress, seed) the
// UI renders. The factor weights below are deliberately never exposed.
//
// # Lock discipline
//
// This process answers three surfaces at once: bus event deliveries (every
// message, turn and agent run on the instance), the UI's kandy webhook poll
// (every 1-3s per open session) and kandev's plugin health check, which
// rides the same transport. Up to v0.12.0 a single mutex covered all of
// them AND was held across Host round-trips, so one slow Host call stopped
// the plugin answering anything — the state kandev reports as
// `status: error`, where it can neither disable the plugin nor shut down
// cleanly.
//
// The rules now, in order of importance:
//
//  1. p.mu is NEVER held across a Host RPC. It guards in-memory ledger
//     mutation and nothing else. Every Host call happens after it is
//     released.
//  2. Every Host round-trip runs under hostCallTimeout, so a stalled kandev
//     can park a plugin goroutine for a bounded time and no longer.
//  3. Reads serve from the in-memory snapshot. The kandy webhook, pet and
//     bonk all build their reply from a copy taken under RLock, so they
//     never queue behind an event's persist.
//  4. stateKey has exactly ONE writer, a background goroutine (writeLoop).
//     Mutators stage their change in memory and wait only for their OWN
//     version to settle — the writer coalesces, so that wait is one write
//     in flight plus one, never the depth of the backlog. Being held for
//     the length of an event storm is the writer's job, and it is the only
//     thing here allowed to be slow.
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

	// maxAncestors bounds the retired-elder list kept in state. The UI only
	// stands a handful of them in the scene; the cap keeps the ledger row
	// small no matter how many centuries of work land on this instance.
	// Oldest are dropped first — the recent lineage is the visible one.
	maxAncestors = 8

	// maxRebirthsPerAward bounds applyRebirth's loop. Real awards are worth
	// at most xpAgentCompleted, so one crossing per award is the ceiling in
	// practice; the loop only exists because ?debug_grant can hand over a
	// billion XP at once, and a bound is cheaper than trusting the caller.
	maxRebirthsPerAward = 8

	// hostCallTimeout bounds EVERY Host round-trip. kandev delivers events,
	// polls the webhook and health-checks the plugin over one gRPC
	// connection, so an unbounded Host call is the difference between "one
	// slow write" and "the plugin looks dead". It sits above kandev's own
	// state-write latency but well under the delivery retry backoff (5s).
	hostCallTimeout = 4 * time.Second
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
	// LastPassiveHealAt (RFC3339) checkpoints the "time heals" accrual
	// (v0.6.4) so passive healing is never double-applied. Missing on
	// pre-0.6.4 state: initialized to now on first sight, deliberately
	// with NO retroactive healing (see passiveHealUpdate).
	LastPassiveHealAt string `json:"last_passive_heal_at,omitempty"`
	// Anti-tamper seal (v0.9.0, see seal.go): Sealv tags the canonical
	// serialization scheme and Sig is the hex HMAC-SHA256 over it, keyed
	// from kandev's encrypted secrets vault. Neither ever leaves the
	// server. Counterfeit latches true FOREVER when tampering is detected
	// — it is itself sealed, survives every write and every rebirth.
	Sealv       int    `json:"sealv,omitempty"`
	Sig         string `json:"sig,omitempty"`
	Counterfeit bool   `json:"counterfeit,omitempty"`

	// Rebirth (v0.13.0, see applyRebirth): growing past the band retires the
	// creature into Ancestors and lays a fresh egg with new DNA. Generation
	// counts the eggs this lineage has laid — 0 on pre-0.13 state, read
	// everywhere through generationOf as 1. RebornAt (RFC3339) stamps the
	// current egg's ascension so the UI can play it exactly once.
	Generation int              `json:"generation,omitempty"`
	Ancestors  []ancestorRecord `json:"ancestors,omitempty"`
	RebornAt   string           `json:"reborn_at,omitempty"`
	// HomeSalt fixes the BIOME for the whole lineage. The creature's own DNA
	// (archetype, palette, style picks) is re-rolled on every rebirth, but
	// the place is not: the elders stand in this scene, and a habitat that
	// swapped out from under them would break the illusion. Zero means "not
	// recorded yet" — read through homeSaltOf, which falls back to Salt, so
	// pre-0.13 state and first-generation kandys are unaffected.
	HomeSalt uint32 `json:"home_salt,omitempty"`

	// transient marks a ledger that is NOT the persisted truth: a stand-in
	// served while the Host broker is still connecting or after a state
	// read failed. Unexported, so it never reaches JSON, the seal, or
	// Host state. Mood must not read a transient ledger's timestamps as
	// real activity — see sinceLastAward.
	transient bool
}

// ancestorRecord is one retired kandy, kept forever (up to maxAncestors) so
// it can stand in the scene background. Only its DNA salt and the few
// presentation facts the background figure needs are stored — no XP, no
// counters, no care history.
type ancestorRecord struct {
	Salt      uint32 `json:"salt"`
	Level     int    `json:"level"`
	BornAt    string `json:"born_at,omitempty"`
	RetiredAt string `json:"retired_at,omitempty"`
	Scarred   bool   `json:"scarred,omitempty"`
}

// ancestorView is an ancestor as the UI sees it: derived DNA only. The raw
// salt never crosses this boundary, exactly like the living kandy's.
type ancestorView struct {
	Level       int    `json:"level"`
	Archetype   int    `json:"archetype"`
	Family      int    `json:"family"`
	LineageSeed uint32 `json:"lineage_seed"`
	StageName   string `json:"stage_name"`
	Generation  int    `json:"generation"`
	Scarred     bool   `json:"scarred"`
	RetiredAt   string `json:"retired_at,omitempty"`
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
	// Counterfeit is the permanent tamper mark (see seal.go). The UI gets
	// the boolean only — never the signature or the key.
	Counterfeit  bool                `json:"counterfeit"`
	RefusingPets bool                `json:"refusing_pets"`
	Flavor       string              `json:"flavor"`
	AliveSince   string              `json:"alive_since"`
	TokenGrotto  tokenGrottoResponse `json:"token_grotto"`
	// Generation is 1 for a first-of-its-line kandy and rises with every
	// rebirth; Ancestors are the retired elders, oldest first, that the UI
	// stands in the scene background. RebornAt stamps the current egg so the
	// UI plays the ascension once and never again.
	Generation int            `json:"generation"`
	Ancestors  []ancestorView `json:"ancestors,omitempty"`
	RebornAt   string         `json:"reborn_at,omitempty"`
}

type plugin struct {
	pluginsdk.UnimplementedPlugin

	// mu guards the in-memory kandy — cached, grottoCached, sealKey and the
	// ledger version counters. INVARIANT: mu is never held across a Host
	// RPC; see the lock discipline note in the package comment.
	mu           sync.RWMutex
	cached       *ledger
	grottoCached *tokenGrottoLedger
	// sealKey is the decoded ledger HMAC key, memoized for the process
	// lifetime after the first successful vault read (see seal.go).
	sealKey []byte
	// ledgerVersion counts in-memory mutations, ledgerAttempted is the
	// highest version whose write has concluded (either way) and
	// ledgerPersisted the highest version that actually landed. The writer
	// and everybody waiting on it run entirely off these three.
	ledgerVersion   int64
	ledgerAttempted int64
	ledgerPersisted int64
	// writeRound is closed and replaced every time a version settles: it is
	// the broadcast waiters block on. Never nil after newPlugin.
	writeRound chan struct{}

	// writeSignal (buffered 1) wakes the writer; writeStop ends it.
	writeSignal chan struct{}
	writeStop   chan struct{}
	writerOnce  sync.Once
	stopOnce    sync.Once

	// loadMu serializes the cold-start ledger read so a burst of events
	// cannot fan out into one GetState per event. The writer never takes
	// it, so a webhook read never waits behind an event's persist.
	loadMu sync.Mutex
	// grottoMu serializes the token grotto's read-modify-write. The webhook
	// read path only ever TryLocks it (see presentTokenGrotto).
	grottoMu sync.Mutex
	// sealMu serializes the one-time vault fetch of the HMAC key.
	sealMu sync.Mutex

	// Seams injected for tests; production values set in newPlugin.
	now         func() time.Time
	saltFunc    func() uint32
	hostTimeout time.Duration
}

func newPlugin() *plugin {
	return &plugin{
		now:         time.Now,
		saltFunc:    rand.Uint32,
		hostTimeout: hostCallTimeout,
		writeRound:  make(chan struct{}),
		writeSignal: make(chan struct{}, 1),
		writeStop:   make(chan struct{}),
	}
}

// close stops the writer goroutine. Production never calls it — the plugin
// lives as long as the process — but tests do, so a package run does not
// accumulate one parked goroutine per plugin.
func (p *plugin) close() {
	p.stopOnce.Do(func() { close(p.writeStop) })
}

// boundedContext derives a Host-call context from ctx that always expires,
// so a stalled kandev can never park a plugin goroutine indefinitely.
func (p *plugin) boundedContext(ctx context.Context) (context.Context, context.CancelFunc) {
	if ctx == nil {
		ctx = context.Background()
	}
	timeout := p.hostTimeout
	if timeout <= 0 {
		timeout = hostCallTimeout
	}
	return context.WithTimeout(ctx, timeout)
}

// detachedContext is boundedContext for writes the caller does not own: the
// baton holder may be draining somebody else's mutation, and a cancelled
// event delivery must not abandon a durable write half-way through.
func (p *plugin) detachedContext(ctx context.Context) (context.Context, context.CancelFunc) {
	if ctx == nil {
		ctx = context.Background()
	}
	return p.boundedContext(context.WithoutCancel(ctx))
}

// getState / setState are the bounded Host state calls. Every Host round-trip
// in this plugin goes through one of these (or their secret/config siblings)
// so no call site can forget the timeout.
func (p *plugin) getState(ctx context.Context, host pluginsdk.Host, key string) (map[string]any, bool, error) {
	callCtx, cancel := p.boundedContext(ctx)
	defer cancel()
	return host.GetState(callCtx, stateScope, "", key)
}

func (p *plugin) setState(ctx context.Context, host pluginsdk.Host, key string, value map[string]any) error {
	callCtx, cancel := p.detachedContext(ctx)
	defer cancel()
	return host.SetState(callCtx, stateScope, "", key, value)
}

// cachedLedger returns a COPY of the in-memory ledger under a read lock.
// This is the whole read path: no Host I/O, no writer contention.
func (p *plugin) cachedLedger() (*ledger, bool) {
	p.mu.RLock()
	defer p.mu.RUnlock()
	if p.cached == nil {
		return nil, false
	}
	copied := *p.cached
	return &copied, true
}

// ledgerSnapshot returns a copy of the ledger, reading it through Host state
// on first use (and creating a fresh egg when none is persisted yet).
// cached reports whether the copy reflects persisted truth: false means the
// Host was unavailable and the caller holds a transient stand-in that must
// never be persisted (see ledger.transient).
//
// The Host read runs under loadMu with p.mu released, so a cold start
// serializes into one round-trip instead of one per caller — and once the
// ledger is cached this never touches the Host again.
func (p *plugin) ledgerSnapshot(ctx context.Context) (*ledger, bool) {
	if l, ok := p.cachedLedger(); ok {
		return l, true
	}
	p.loadMu.Lock()
	defer p.loadMu.Unlock()
	if l, ok := p.cachedLedger(); ok {
		return l, true
	}
	loaded, cacheable := p.readLedger(ctx)
	if !cacheable {
		return loaded, false
	}
	p.mu.Lock()
	p.cached = loaded
	copied := *p.cached
	p.mu.Unlock()
	return &copied, true
}

// readLedger performs the Host read behind ledgerSnapshot. A persisted
// ledger passes through the anti-tamper decision table (seal.go) before
// being served. Callers hold loadMu and MUST NOT hold p.mu.
func (p *plugin) readLedger(ctx context.Context) (*ledger, bool) {
	fresh := &ledger{
		Salt:      p.saltFunc(),
		CreatedAt: p.now().UTC().Format(time.RFC3339),
		UpdatedAt: p.now().UTC().Format(time.RFC3339),
	}
	host := p.Host()
	if host == nil {
		// Host broker not connected yet: serve a transient egg but do not
		// cache it, so the persisted ledger wins once the Host arrives.
		fresh.transient = true
		return fresh, false
	}
	value, found, err := p.getState(ctx, host, stateKey)
	if err != nil {
		log.Printf("kandy: reading state: %v", err)
		fresh.transient = true
		return fresh, false
	}
	if !found {
		// A fully deleted row is murder, not fraud: a clean fresh egg,
		// WITHOUT the counterfeit mark, even when a seal key exists.
		return fresh, true
	}
	return p.verifyLoadedLedger(ctx, host, ledgerFromMap(value))
}

// mutateLedger applies fn to the in-memory ledger and hands the result to
// the single writer. Returns a snapshot of the ledger to serve.
//
// The mutation itself happens under p.mu with no Host call in sight; the
// persist runs after the lock is released. When the Host is unavailable the
// mutation is applied to a transient stand-in and served from memory only —
// writing a stand-in ledger would strand the persisted kandy, and losing an
// award to an outage is the cheaper of the two.
func (p *plugin) mutateLedger(ctx context.Context, fn func(*ledger)) *ledger {
	snapshot, cached := p.ledgerSnapshot(ctx)
	if !cached {
		fn(snapshot)
		snapshot.UpdatedAt = p.now().UTC().Format(time.RFC3339)
		return snapshot
	}
	p.mu.Lock()
	fn(p.cached)
	p.cached.UpdatedAt = p.now().UTC().Format(time.RFC3339)
	p.ledgerVersion++
	version := p.ledgerVersion
	served := *p.cached
	p.mu.Unlock()
	p.persistLedger(version)
	return &served
}

// markLedgerDirty bumps the version without touching the ledger, so a caller
// that needs the current in-memory kandy on disk (the token grotto's lineage
// check) can ask for a write without staging a mutation. Returns the version
// it must see in ledgerPersisted for the write to count.
func (p *plugin) markLedgerDirty() int64 {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.ledgerVersion++
	return p.ledgerVersion
}

// ledgerReachedDisk reports whether a write of version (or anything newer)
// has landed in Host state.
func (p *plugin) ledgerReachedDisk(version int64) bool {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.ledgerPersisted >= version
}

// persistLedger asks the writer to put version on disk and waits for that
// version to settle — written, failed, or the wait budget expired.
//
// The wait is what keeps XP durable without letting anyone be held hostage.
// The writer coalesces, so a caller waits for at most the write already in
// flight plus its own, however deep the backlog behind it is. If even that
// overruns the budget the caller simply leaves: the mutation is in the
// in-memory ledger and the writer carries it, which is strictly better than
// a delivery that kandev times out and retries into a double award.
func (p *plugin) persistLedger(version int64) {
	p.startWriter()
	select {
	case p.writeSignal <- struct{}{}:
	default: // a wake-up is already queued; the writer re-reads the version
	}
	p.awaitLedgerVersion(version)
}

// startWriter spawns the one goroutine allowed to write stateKey. It is
// lazy so a plugin that never mutates (a webhook-only test) never spawns it.
func (p *plugin) startWriter() {
	p.writerOnce.Do(func() { go p.writeLoop() })
}

func (p *plugin) writeLoop() {
	for {
		select {
		case <-p.writeStop:
			return
		case <-p.writeSignal:
		}
		// context.Background(), not a caller's: the writer outlives every
		// request, and a cancelled event delivery must not abandon a
		// durable write half-way through. setState bounds it anyway.
		p.drainLedger(context.Background())
	}
}

// drainLedger writes out every pending ledger version until none is left.
// Only writeLoop calls it, which is what makes stateKey single-writer.
//
// A write that fails — a vault outage, a Host error — is logged and dropped
// rather than retried in place: the mutation stays in the in-memory ledger,
// so the next award persists it cumulatively. Writing an unsealable ledger
// would read as tampering after the vault recovers, and a false counterfeit
// verdict is worse than losing an award to an outage.
func (p *plugin) drainLedger(ctx context.Context) {
	for {
		p.mu.Lock()
		if p.cached == nil || p.ledgerAttempted >= p.ledgerVersion {
			p.mu.Unlock()
			return
		}
		version := p.ledgerVersion
		pending := *p.cached
		p.mu.Unlock()

		persisted := p.writeLedger(ctx, &pending)

		p.mu.Lock()
		p.ledgerAttempted = version
		if persisted && version > p.ledgerPersisted {
			p.ledgerPersisted = version
		}
		// Hand the new round to waiters before waking them, so a waiter
		// that re-checks and blocks again does not miss the next settle.
		round := p.writeRound
		p.writeRound = make(chan struct{})
		p.mu.Unlock()
		close(round)
	}
}

// writeLedger seals and stores one ledger snapshot. Reports whether it
// landed. Never called with p.mu held.
func (p *plugin) writeLedger(ctx context.Context, pending *ledger) bool {
	host := p.Host()
	if host == nil {
		return false
	}
	key, _, err := p.ensureSealKey(ctx, host)
	if err != nil {
		log.Printf("kandy: seal key unavailable, skipping persist: %v", err)
		return false
	}
	sealLedger(pending, key)
	if err := p.setState(ctx, host, stateKey, ledgerToMap(pending)); err != nil {
		log.Printf("kandy: persisting state: %v", err)
		return false
	}
	return true
}

// awaitLedgerVersion blocks until a write attempt for version has concluded,
// or the budget runs out. The budget is one Host timeout: past that the
// writer is the slow one, and holding a delivery or a webhook hostage buys
// nothing the writer will not do on its own.
func (p *plugin) awaitLedgerVersion(version int64) {
	timeout := p.hostTimeout
	if timeout <= 0 {
		timeout = hostCallTimeout
	}
	budget := time.NewTimer(timeout)
	defer budget.Stop()
	for {
		p.mu.RLock()
		settled := p.ledgerAttempted >= version
		round := p.writeRound
		p.mu.RUnlock()
		if settled {
			return
		}
		select {
		case <-round:
		case <-budget.C:
			return
		case <-p.writeStop:
			return
		}
	}
}

// awardXP is mutateLedger plus the per-award bookkeeping (sequence bump +
// last-award timestamp for the mood), and the one place a rebirth can start:
// only real growth closes the band, never a pet, a bonk or a passive heal.
func (p *plugin) awardXP(ctx context.Context, apply func(*ledger)) *ledger {
	return p.mutateLedger(ctx, func(l *ledger) {
		apply(l)
		l.AwardSeq++
		l.LastAwardAt = p.now().UTC().Format(time.RFC3339)
		p.applyRebirth(l)
	})
}

// generationOf reads the lineage generation, treating pre-0.13 state (no
// field) as the first generation. Every reader goes through this.
func generationOf(l *ledger) int {
	if l.Generation < 1 {
		return 1
	}
	return l.Generation
}

// homeSaltOf returns the salt the lineage's BIOME is derived from: the
// founder's, once one has been recorded, otherwise the living creature's.
func homeSaltOf(l *ledger) uint32 {
	if l.HomeSalt != 0 {
		return l.HomeSalt
	}
	return l.Salt
}

// applyRebirth closes the arc. Level bandMax (100) is a RESTING PLACE, not a
// trigger: a kandy that gets there stays there, fully grown, for a whole
// level's worth of XP — roughly a month of real work, after two and a half
// years of raising it. The award that would carry it past the band is the one
// that ascends it: the grown creature is filed into Ancestors — where the UI
// stands it in the scene background, at its final size, forever — and a fresh
// egg with new DNA takes its place.
//
// What crosses the rebirth, and why:
//
//   - XP: only the band is spent (xp -= thresholdXP(ascendLevel)). The
//     overflow carries into the egg, so no shipped work is ever swallowed by
//     the moment the ledger happens to tip over.
//   - Temperament: HALVED, not cleared. The bond is with the keeper, not the
//     body — a new creature has heard about you, but only second-hand.
//   - Scarred: cleared. A scar is on a body, and this is a new one. The
//     ancestor keeps its scar and wears it in the background.
//   - Counterfeit: untouched. The mark is permanent and outlives every
//     lineage, exactly as the tamper rebirth (seal.go) promises.
//   - LastAwardAt / AwardSeq / the care timestamps: untouched. The egg was
//     laid by work that just landed, so it starts elated, and no pet or bonk
//     rate-limit window is reset by ascending.
//
// Counters restart with the creature. The Token Grotto is keyed by salt, so
// the new lineage digs its own — the deliberate "token history follows the
// lineage" rule the grotto already documents.
//
// Called under p.mu from awardXP's mutation; pure bookkeeping, no I/O.
func (p *plugin) applyRebirth(l *ledger) {
	for n := 0; levelForXP(l.XP) >= ascendLevel; n++ {
		if n >= maxRebirthsPerAward {
			// Only reachable through ?debug_grant handing over more XP than
			// several full bands. Park on the last level of the band rather
			// than spinning: the next award lands normally.
			l.XP = math.Nextafter(thresholdXP(ascendLevel), 0)
			return
		}
		now := p.now().UTC().Format(time.RFC3339)
		l.Ancestors = append(l.Ancestors, ancestorRecord{
			Salt: l.Salt,
			// The elder is remembered at the last level it wore, not at the
			// level that ascended it — nothing ever renders as ascendLevel.
			Level:     bandMax,
			BornAt:    l.CreatedAt,
			RetiredAt: now,
			Scarred:   l.Scarred,
		})
		if len(l.Ancestors) > maxAncestors {
			l.Ancestors = append([]ancestorRecord(nil), l.Ancestors[len(l.Ancestors)-maxAncestors:]...)
		}
		l.XP -= thresholdXP(ascendLevel)
		if l.XP < 0 {
			l.XP = 0
		}
		if l.HomeSalt == 0 {
			// First ascension: the founder's salt becomes the lineage's home,
			// so every later generation hatches into the same biome.
			l.HomeSalt = l.Salt
		}
		l.Salt = p.saltFunc()
		l.Generation = generationOf(l) + 1
		l.CreatedAt = now
		l.RebornAt = now
		l.Messages = 0
		l.Turns = 0
		l.AgentRuns = 0
		l.Temperament = clampTemperament(l.Temperament / 2)
		l.Scarred = false
	}
}

// presentAncestors converts stored elders into the DNA-only view the UI
// renders, oldest first. Generation numbers them: the first ancestor was
// generation 1, and the living kandy is generationOf(l).
func presentAncestors(l *ledger) []ancestorView {
	if len(l.Ancestors) == 0 {
		return nil
	}
	// The list is capped, so the oldest kept elder is not necessarily
	// generation 1 — count back from the living generation instead.
	first := generationOf(l) - len(l.Ancestors)
	if first < 1 {
		first = 1 // only reachable from an inconsistent (tampered) ledger
	}
	out := make([]ancestorView, 0, len(l.Ancestors))
	for i, a := range l.Ancestors {
		level := a.Level
		if level < 1 {
			level = bandMax
		}
		out = append(out, ancestorView{
			Level:       level,
			Archetype:   archetypeForLineage(a.Salt),
			Family:      paletteFamilyForLineage(a.Salt),
			LineageSeed: lineageSeed(a.Salt),
			StageName:   stageName(a.Salt, level),
			Generation:  first + i,
			Scarred:     a.Scarred,
			RetiredAt:   a.RetiredAt,
		})
	}
	return out
}

// OnEvent feeds the kandy. It always returns nil — kandev retries
// deliveries on error with the same EventID, and a retried delivery of an
// already-counted event would farm duplicate XP — so parse failures and
// state hiccups are logged and swallowed.
func (p *plugin) OnEvent(ctx context.Context, e *pluginsdk.Event) error {
	if e == nil {
		return nil
	}
	if isTokenUsageEvent(e.EventType) {
		p.observeTokenUsage(ctx, e)
		return nil
	}
	delta, apply := xpForEvent(e)
	if delta <= 0 {
		return nil
	}
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

	p.healPassively(ctx)

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

	l, _ := p.ledgerSnapshot(ctx)
	view := p.presentKandy(ctx, l, idleOverride)
	body, err := json.Marshal(view)
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
	p.healPassively(ctx)
	l, _ := p.ledgerSnapshot(ctx)
	// Distrust: freshly bonked, the kandy refuses pets entirely — no
	// stamp, no lift, no temperament change. The UI mirrors this with a
	// turn-away reaction.
	if p.within(l.LastBonkedAt, distrustWindow) {
		view := p.presentKandy(ctx, l, nil)
		view.Flavor = "It doesn't trust you right now."
		return presentResponse(view)
	}
	// Plain mutateLedger, not awardXP: no XP, no award_seq bump, no
	// last_award_at change. The temperament effect is rate-limited to one
	// per petEffectWindow, gains nothing within careCalmWindow of a bonk,
	// and heals negative scores at petHealGain — a repair pet is worth
	// more than a trust-building one (see temperament.go).
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
	view := p.presentKandy(ctx, l, nil)
	return presentResponse(view)
}

// handleBonk dumps a bucket of cold water on the kandy. Like petting it never touches
// XP/level/award_seq — but unlike petting it pushes the persistent
// temperament DOWN (rate-limited to one effect per bonkEffectWindow; the
// stamp always refreshes, so spamming keeps resetting the window instead
// of stacking trauma), cancels any active pet lift, drops the displayed
// mood one tier for bonkMoodWindow, and opens the distrust window.
func (p *plugin) handleBonk(ctx context.Context) *pluginsdk.WebhookResponse {
	p.healPassively(ctx) // accrued days settle BEFORE the new bonk re-gates them
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
	view := p.presentKandy(ctx, l, nil)
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

func (p *plugin) presentKandy(ctx context.Context, l *ledger, idleOverride *time.Duration) kandyResponse {
	view := p.presentLedger(l, idleOverride)
	view.TokenGrotto = p.presentTokenGrotto(ctx, l.Salt)
	return view
}

// applyDebugGrant handles the ?debug_grant dev/demo knob. It grants XP only
// when the operator flipped the plugin's `debug` config on; otherwise it
// short-circuits with an error response (non-nil return means "reply with
// this instead of the normal payload").
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
	callCtx, cancel := p.boundedContext(ctx)
	defer cancel()
	config, err := host.GetConfig(callCtx)
	if err != nil {
		log.Printf("kandy: reading config: %v", err)
		return false
	}
	enabled, _ := config[configKeyDebug].(bool)
	return enabled
}

// healPassively applies the "time heals" rule (see passiveHealUpdate)
// lazily on webhook computation — like mood, there are no background jobs;
// the drift settles whenever the kandy is next looked at, petted or bonked.
// Persists only when something actually changed (checkpoint init or heal
// applied), so plain reads of a healthy kandy never write state — which is
// what keeps the UI's 1-3s poll off the Host write path entirely.
//
// A transient stand-in is skipped: healing an egg that is about to be thrown
// away accrues nothing, and the drift settles on the first real load.
func (p *plugin) healPassively(ctx context.Context) {
	if _, cached := p.ledgerSnapshot(ctx); !cached {
		return
	}
	p.mu.Lock()
	healed := passiveHealUpdate(p.cached, p.now().UTC())
	if healed {
		p.cached.UpdatedAt = p.now().UTC().Format(time.RFC3339)
		p.ledgerVersion++
	}
	version := p.ledgerVersion
	p.mu.Unlock()
	if healed {
		p.persistLedger(version)
	}
}

// within reports whether the RFC3339 stamp is less than window old. An
// empty or unparsable stamp is never "within" anything.
func (p *plugin) within(stamp string, window time.Duration) bool {
	t, err := time.Parse(time.RFC3339, stamp)
	return err == nil && p.now().UTC().Sub(t) < window
}

// unknownIdle is the idle time reported when the real one cannot be known
// (a transient stand-in ledger). It lands mid-"content": neutral, and
// deliberately NOT "elated" — a kandy that has just been served from a
// stand-in has no idea when it was last fed, and claiming it was fed
// seconds ago is the more misleading of the two lies.
const unknownIdle = 24 * time.Hour

// sinceLastAward computes how long ago the kandy was last fed.
// Migration-safe: pre-0.6 PERSISTED state has no last_award_at, so fall
// back to updated_at (every award touched it). A transient stand-in is
// never read this way: its timestamps were minted this instant by
// readLedger, so both stamps would say "just now" and the badge would
// claim elated right after a restart, no matter how long the instance had
// actually been idle.
func (p *plugin) sinceLastAward(l *ledger) time.Duration {
	if l.transient {
		return unknownIdle
	}
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
	generation := generationOf(l)
	flavor := flavorText(l.Salt, level, mood)
	if level <= 1 {
		flavor = eggFlavor(generation)
	}
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
	// Last, temperament caps the displayed mood (wary -> content,
	// fearful -> bored): trust gates happiness, and no pet lift or fresh
	// XP can bust the ceiling — only winning trust back raises it.
	mood = capMoodForBand(mood, band)
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
		Biome:           biomeForLineage(homeSaltOf(l)),
		LineageSeed:     lineageSeed(l.Salt),
		StageName:       stageName(l.Salt, level),
		ProgressPct:     roundDownToTenth(progressPct(l.XP)),
		AppearanceSeed:  appearanceSeed(l.Salt, level),
		Mood:            mood,
		AwardSeq:        l.AwardSeq,
		LastAwardAt:     l.LastAwardAt,
		TemperamentBand: band,
		Scarred:         l.Scarred,
		Counterfeit:     l.Counterfeit,
		RefusingPets:    p.within(l.LastBonkedAt, distrustWindow),
		Flavor:          flavor,
		AliveSince:      l.CreatedAt,
		Generation:      generation,
		Ancestors:       presentAncestors(l),
		RebornAt:        l.RebornAt,
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
