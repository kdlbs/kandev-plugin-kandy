# Kandy — implementation plan

A Tamakandy-style creature living in the `chat-top-bar` slot that evolves
forever from the work happening in the Kandev instance. All XP logic is
server-side (Go plugin backend); the UI only renders what the webhook returns.

## 1. XP model (hidden from the user)

Factors, awarded in `OnEvent` (subjects verified against
`apps/backend/internal/events/types.go` and `docs/public/plugins-manifest.md`):

| Bus subject | Condition | XP |
|---|---|---|
| `message.added` | any message persisted | +1 |
| `turn.completed` | agent turn finished | +8 |
| `agent.completed` | agent run finished successfully | +20 |
| `task.state_changed` | payload `new_state == "COMPLETED"` | +150 |

**Token-spend factor: dropped (deliberate).** `session_prompt_usage.updated`
is published on a per-session-suffixed subject
(`session_prompt_usage.updated.<sessionId>`, 3 segments) but with
`event.Type = "session_prompt_usage.updated"` (2 segments). The plugin
deliverer (`internal/plugins/delivery/deliverer.go` `makeHandler`) re-checks
the subscription pattern against `event.Type` with segment-count-strict
`manifest.MatchSubject`, so a 3-segment wildcard pattern that matches the bus
subject always fails the re-check, and a 2-segment pattern never matches the
bus subject. Token usage events are therefore undeliverable to plugins today.
Turn/message weights are raised to compensate. (Turn XP indirectly tracks
tokens anyway: more work per session = more turns.)

Idempotency: kandev retries a delivery (same `EventID`, up to 3x) only when
`OnEvent` returns an error. `OnEvent` always returns `nil` — including on
malformed payloads and state-write failures — so retries can never farm
duplicate XP. Delivery is sequential per plugin; a webhook `debug_grant` may
race with `OnEvent`, so the ledger read-modify-write is guarded by a mutex in
the plugin process (single supervised process per instance).

## 2. Level formula (log — never caps)

```
threshold(L) = K * (B^(L-1) - 1)          // XP needed to *reach* level L
level(xp)    = floor(log(1 + xp/K) / log(B)) + 1
progress     = (xp - threshold(L)) / (threshold(L+1) - threshold(L)) * 100
K = 400, B = 1.32                          // v0.2.0 retune
```

- History: v0.1 K=200/B=1.75 (year one ≈ Lv17); v0.2 K=400/B=1.32 with a
  40-level band. A simulation against the user's REAL production database
  then showed (a) tasks never reach COMPLETED — the actual workflow ends at
  REVIEW and tasks get ARCHIVED, so task XP never fired (fixed in v0.4:
  archive awards it, once per task), and (b) at the measured pace (18
  active days/30, ~129 turns + ~8.4 archived tasks + ~2 msgs/turn per
  active day => ~2,860 XP/active day, ~51.5k/month) Lv40 was ~33 years out.
- v0.4.0 shipped K=2100/B=1.07, but a single archived task (~193 XP
  all-in) still bought more than a whole early level. v0.6.0 (approved):
  **K=9174, B=1.0545, band 1..100** — an early level costs ~3 shipped
  tasks (threshold(2)=500), endgame timing unchanged. Expected levels at
  the measured pace (~51.5k XP/month):

  | After | day 1 | 1 month | 6 months | 12 months | 30 months | ~34 months |
  |---|---|---|---|---|---|---|
  | Level | ~6 | ~36 | ~67 | ~80 | ~97 | **100** |

  Month one moves a level every 1-2 days; "max" (Lv100) lands at ~2.8 years.
  Beyond it only the infinite prestige ladder continues. Geometric growth
  stretches forever; float64 log stays finite and monotonic for any
  realistic xp, so there is no cap.
- Unit-tested properties: monotonic in xp, never NaN/Inf, `level(0) == 1`,
  progress always in `[0, 100)`, thresholds strictly increasing, and the
  month/year expectations above.

## 3. State & persistence

Host state (requires `capabilities.state: true`), scope `instance`,
scopeID `""`, key `kandy` — one small JSON object, participates in kandev
backups, survives upgrades, removed on uninstall:

```json
{ "xp": 123.0, "messages": 40, "turns": 12, "agent_runs": 3, "tasks_done": 1,
  "salt": 305419896, "created_at": "RFC3339", "updated_at": "RFC3339" }
```

- `salt` is a random uint32 chosen once at first write — per-instance lineage
  so two instances at the same level look different.
- Counters are internal bookkeeping only; the webhook never returns them.
- Writes are cheap read-modify-write per event (fine at this event rate).
- Cold cache: state is read through the Host on first use after start, then
  cached in-process (mutex-guarded) and written through on change.

## 4. Manifest

```yaml
id: kandev-plugin-kandy | api_version: 1 | version: 0.1.0
display_name: "Kandy" | categories: ["tools"]
runtime.type: binary (linux-amd64 for host loop; full package builds all 5)
capabilities:
  state: true
  events: [task.state_changed, turn.completed, agent.completed, message.added]
webhooks: [{ key: kandy, method: GET }]
ui.bundle: /ui/bundle.js
config_schema: { debug: boolean, default false }
```

## 5. Webhook API (`GET .../webhooks/kandy`)

Response — creature facts only, no factor breakdown:

```json
{ "level": 6, "tier": 1, "stage_name": "Mossy Sproutling",
  "progress_pct": 42.5, "appearance_seed": 987654321,
  "flavor": "Your kandy looks energized.", "alive_since": "RFC3339" }
```

- `appearance_seed = fnv32(salt ":" level)` — deterministic per level per
  instance; changes on every evolution.
- `?debug_grant=<n>` (n in 1..10^9) adds n XP **only** when plugin config
  `debug == true`; otherwise responds 403 and grants nothing. Documented in
  README as a dev/demo knob.
- Flavor text: cryptic only, chosen deterministically from seeded word lists,
  with an activity overlay (recently fed vs. napping) derived from
  `updated_at` — never mentions factors or numbers.

## 6. Procedural evolution

> **v0.3.0 — DNA vs growth.** v0.2's per-level archetype cycling broke the
> tamakandy fantasy ("it's a different guy every level"). v0.3 splits the
> generator: the **salt is DNA** — it fixes archetype/species, palette
> family, biome, and lineage style picks (eye/horn/tail/marking/held-item
> styles via `lineage_seed`) for the whole lifetime — while the **level is
> growth**: a strictly additive unlock ladder (one new/upgraded element per
> level 2..40: markings, tail/horn/wing growth, companions, held items,
> crown@15, glow@25, halo@30, aura@31/36, rays@35, burst@40) over
> metamorphosis milestones (hatch 2, juvenile 8, adult 18, majestic 30)
> that scale/mature the same body. Colors ramp dull->vivid with level;
> scenes stay in one biome (verdant/aquatic/alpine/ember) maturing through
> 5 phases (barren -> sparse -> lively -> lush -> celestial); names keep a
> fixed species with an epithet ladder from "Timid" to "Celestial". A Go
> `richnessScore` proves the awesomeness budget strictly increases across
> the band and never dips after. The v0.2 text below is retained only for
> the parts it still describes (determinism, no render-time randomness).

Everything derives from `(salt, level)` server-side and
`(appearance_seed, level, tier, archetype)` in the UI via a mulberry32
seeded PRNG — **no `Math.random` at render time**, so no flicker.

- **Body archetypes (10)**: round blob, tall/lanky, squat/wide, serpentine,
  mushroom-capped, ghost/floaty, crystalline/angular, mech/boxy, multi-eyed
  alien, winged sprite. The backend walks a salt-shuffled permutation with a
  +1-per-cycle rotation, so **consecutive levels are guaranteed different
  silhouettes** (distinct permutation slots), at any level, forever. The
  chosen archetype travels in the webhook so the name and the render can
  never disagree.
- **Part swaps, not accumulation**: per level the seed picks eye style
  (round/wide/sleepy/dot; aliens get 3-5 eyes), mouth (smile/open/fang/
  flat/wavy), horns (none/nubs/curved/antlers/unicorn/antenna), tail
  (none/curl/spike/fluff, grounded bodies only), and a companion
  (none/orbiting pet/flag/tool/balloon) — each level gains a signature
  feature and loses another. **Prestige parts only accumulate at
  milestones**: crown at 15, halo at 30, aura ring at 60.
- **Palette identity per level**: 12 palette families; a rotating-index walk
  over the family list makes adjacent levels jump families (green → purple
  → amber…), never micro-rotate hue. Seeded jitter stays within the family.
- **Scenes (14)**: meadow, forest, lake, mountain, city dusk, neon night,
  aurora, deep space, cave, desert, ruins, volcano, workshop, underwater.
  Band levels tour them in alternating 2-3 level blocks in a salt-shuffled
  order (meadow always first; adjacent blocks always differ; ≤2 repeats
  before level 40). Beyond level 40 the seeded-cosmos hue ladder advances
  every 5 levels, forever — sameyness is acceptable out there.
- **Stage name**: `<seeded adjective> <archetype species>` (Blip, Willow,
  Chonk, Noodle, Sporeling, Wisp, Shardling, Cogling, Gazer, Flitter);
  level 1 is always "Egg"; past level 40 the mythic prefix ladder plus a
  roman generation numeral every 50 levels keeps names moving. Generated
  server-side so name logic stays hidden and stable.

## 7. UI component structure (`ui/bundle.js`, no build step)

Plain ES module, `window.registerKandevPlugin("kandev-plugin-kandy", ...)`,
`registry.registerComponent("chat-top-bar", ...)`, `host.React` + `host.jsx`
+ `host.ui` Tooltip/TooltipTrigger/TooltipContent (activity-rings pattern).

- Data: `host.api.fetch("webhooks/kandy")` on mount, re-fetch on hover
  (mouseenter/focus) and a 60s interval (cleared on unmount).
- Trigger: ~24px mini creature SVG with subtle idle bob + periodic blink.
- TooltipContent card (~240px): scene background div, ~96px creature with
  idle bob / blink / occasional wiggle, stage name + "Lv N", XP bar
  (rounded track using `var(--muted)` / fill `var(--primary)`) with % to
  next evolution, flavor line. Theme vars where reasonable for light/dark.
- Animations: one injected `<style id="kandev-kandy-style">` (guarded so
  repeat `initialize` is safe) with keyframes `kandy-bob`, `kandy-blink`,
  `kandy-wiggle`; disabled under `prefers-reduced-motion: reduce`.
  `destroy` removes the style tag and clears the interval.

## 8. Test plan (Go, cached go1.26 toolchain; gofmt + go vet clean)

`server/level_test.go` — formula properties (monotonicity sweep, NaN/Inf
guard, level 1 at 0 XP, progress in [0,100), thresholds increasing, sample
constants: level(150)=2, level(412)=3).
`server/plugin_test.go` — fake Host embedding `pluginsdk.UnimplementedHostData`
with an in-memory state map (tokscale test pattern; no gRPC spawn):
- event→XP mapping per subject; task.state_changed to non-COMPLETED = 0 XP;
  unknown event no-op; malformed payload returns nil and grants nothing.
- state round-trip: award, then new plugin value re-reads persisted state.
- webhook shape: fields present; body must NOT leak counters/factor keys.
- debug_grant: no debug config → 403 + no XP; debug=true → XP added; junk n
  rejected. Stage name stable across calls at the same level.

## 9. Demo / screenshot plan (isolated instance)

Throwaway Playwright spec in the monorepo using the e2e backend fixture
(own port/tmpdir/SQLite; plugins feature already on in the e2e profile).
Never touch the real backend/DB; no broad pkill; spec deleted afterwards and
`git status` left clean.

1. `make package-host` → install tarball via `POST /api/plugins/install`.
2. Create task, message the mock agent so real events flow; assert via the
   webhook that lifetime XP grew (proves OnEvent wiring).
3. `PATCH /api/plugins/kandev-plugin-kandy` config `{debug: true}`, then
   `?debug_grant` to jump to mid/high levels.
4. Screenshots to `/tmp/kandev-kandy-demo/screenshots/`: top-bar icon in
   context (crop `[data-testid="task-topbar"]`), hover card at low level
   (egg), 2–3 progressively evolved levels (creature + scene + stage name +
   XP bar), one full page; light + dark (toggle `documentElement.classList`,
   no reload; tooltip located via `[data-slot="tooltip-content"]`).

## 10. Care system — pet or bonk (v0.3.0)

The pet zone in the open card gains a dark twin: **left-click pets, desktop
right-click bonks with a stick** (`contextmenu`, preventDefault; touch stays
pet-only — long-press contextmenu is ignored so accidental long-presses
can't traumatize mobile kandys). Both are presentation/temperament only:
**neither ever touches xp, level, progress_pct, award_seq or last_award_at**
(tested byte-identical across arbitrary pet/bonk sequences).

Persistent ledger additions: `pets_given`, `bonks_given`, `last_bonked_at`,
`last_pet_effect_at`, `temperament` (float in [-100, +100]), `scarred`,
`last_passive_heal_at` (v0.6.4, the time-heals checkpoint).

Constants (server-side, `temperament.go`; healing rebalanced in v0.6.4 —
the "forgiveness patch"):

| Knob | Value | Meaning |
|---|---|---|
| bonk effect | −8, max 1 effect / 10s | every bonk re-stamps `last_bonked_at`, so spam keeps resetting the window and never stacks trauma; deliberate spaced cruelty does (0 → scar = 8 bonks ≥ 10s apart) |
| bonk fallout | mood −1 tier for 30min; pet lift cancelled; pets refused for 60s ("it doesn't trust you right now") | displayed-mood only |
| pet effect | +1 (≥0) / **+3 (<0)**, max 1 effect / **5min**, none within **3h** of a bonk | extra pets still stamp the mood lift; repair pets outweigh trust-building pets — healing a hurt kandy is humane now: −60 → 0 needs 20 effective pets (under 2 hours of devoted petting; a casual few-pets-a-day pace clears it in days, helped by the passive drift below) |
| time heals (v0.6.4) | **+4 per full elapsed day** while temperament < 0 and the last bonk is > 24h old, **clamped at 0** | applied lazily on webhook computation (like mood — no background jobs) from max(`last_bonked_at`, `last_passive_heal_at`); the checkpoint advances by whole days so partial days keep accruing and nothing double-applies. Passive healing only closes wounds — it NEVER raises temperament above 0; positive trust is built only by pets. Migration: a pre-0.6.4 ledger has no checkpoint — it is set to *now* on first sight with **no retro-heal** (no lump payout for old neglect; earning starts at the upgrade moment) |
| affection fades (v0.11.0) | **−10 per day, accrued hourly** while temperament > 0 and the last effective treat is > 12h old, **clamped at 0** | the mirror of "time heals", sharing its lazy accrual and `last_passive_heal_at` checkpoint (measured from max(`last_pet_effect_at`, checkpoint)) but stepping in whole HOURS so the bond slips visibly rather than in daily jumps. Neglect walks a bond back toward neutral and **stops there** — it can never make a kandy wary or fearful; only a bucket does that. Pace: beloved (+30) → content in 2 days, neutral in 3; holding beloved costs ~10 treats/day. Migration: a fond ledger with no checkpoint gets one stamped *now*, so upgrading never retro-fades a bond earned before the rule existed |
| scar latch | temperament ≤ −60 ⇒ `scarred: true` forever | never clears, even fully redeemed |
| bands | beloved ≥ +30, content ≥ +10, neutral (−10, +10), wary ≤ −10, fearful ≤ −40 | webhook exposes only `temperament_band` / `scarred` / `refusing_pets`, never the raw score |

Rendering (render-time conditioning; DNA/growth/unlock tables untouched,
fully deterministic): beloved = rosier bigger cheeks, brighter eye
highlights, perkier horns/tail; wary = guarded flattened eyes (straight
upper lid), slight default frown, drooped tufts/wilted antenna, accents
desaturated −15; fearful = the same, stronger (lids lower, −30 sat);
scarred = one small stitch-mark placed deterministically from the lineage
seed, shown forever. Metamorphosis conditioning: at stage ≥ 2 (levels
12/30/55/80 styling) the CURRENT temperament sign picks a variant — kind
(soft warm sheen around the head) vs wary (scruffy crown spikes) — so
redemption visibly softens the creature. Band flavor lines; a bonk answers
"Your kandy flinched."

## 11. Day/night cycle + sleep (v0.5.0 — pure presentation)

The browser's local clock drives a `timeOfDay` hour float (0-24) threaded
explicitly through `sceneFor(biome, level, seed, timeOfDay)` and
`kandyCard(h, data, celebration, care, timeOfDay)`. Wherever it isn't
supplied it defaults to a fixed mid-day value (13:00), so 3-/4-arg callers
— the evolution posters and older harnesses — keep producing byte-identical
renders (verified old-bundle-vs-new DOM comparison). The widget re-reads
the clock every 60s, so dusk and bedtime arrive without a refetch. The
server is untouched: pet/bonk POSTs and all mechanics behave exactly as
before; only visuals differ.

Day phases: dawn 06:00-08:00 (warm golden wash), day 08:00-18:00 (exactly
the v0.4.x scenes), dusk 18:00-20:00 (orange/pink wash), night otherwise
(deep-blue darkening, the sun suppressed and a glowing cratered moon +
14 extra stars layered ON TOP of the tint). Implemented as one composable
`skyOverlayFor` layer — a CSS gradient prepended onto the biome background
plus an SVG wash rect over the props — so every biome/phase works without
per-biome rewrites. Celestial phases (4-5) are already dark/starry: they
get only a subtle shift and no moon.

Sleep: each kandy has a lineage-seeded schedule (rand stream 21) — a DNA
quirk fixed for the install's lifetime:

| Knob | Range |
|---|---|
| bedtime | 21:30-23:30 (`21.5 + r(0, 2)`) |
| wake | 06:30-08:00 (`6.5 + r(0, 1.5)`) |

While asleep (render-only `sleep_state`, never from the server): eyes
become soft closed lids, a looping zzz bubble floats by the crown (reduced
motion: a static single z), the idle bob and card wiggle stop, and the
static chip portrait sleeps too (aria-label gains ", sleeping"). Petting a
sleeping kandy half-wakes it: a grumpy half-lidded squint for ~2.6s, the
treat still falls, one subdued heart, flavor "Your kandy blinks at you
sleepily." — the pet POST fires exactly as awake. The water bucket wakes
it fully: the existing drench choreography plays unchanged (the rude
awakening). Celebrations are not special-cased and still play over sleep.

## 12. Speech, seasons, arrival greetings (v0.7.0 — pure presentation)

All client-side; the Go server is untouched. Every new visual takes an
explicit parameter with a neutral default (season/speech unset = nothing),
so `__render` tooling and old callers keep byte-identical output — verified
by DOM-diffing the v0.6.5 bundle against v0.7.0 with the new params unset.

**Speech bubbles.** A ~100-line `SPEECH` pool organized by temperament band
x context: per-band `generic` + `greeting` voices (beloved warm with soft
sarcasm, neutral peak deadpan, wary passive-aggressive, fearful quiet and a
little heartbreaking), plus shared pools for `morning`, `latenight` (2am
deploys), `dusk`, `bored`, `gloomy`, `refusing` (post-bonk distrust),
the four seasons, a `scarred` dark-humor sub-pool, and `sleep` murmurs.
Lines are <= 48 chars, no emoji. Selection is deterministic end to end:

- opportunity: each 1-min clock tick, `hash(lineage_seed, tick)` gates at
  25% awake (a bubble every ~4 min of card-open time) and 10% asleep
  (sleep-talk); dialog open ALWAYS greets (never while asleep — no waking
  it just to say hi);
- pick: seeded hash into the band+context pool, generic band pool as
  fallback, with a last-3 no-repeat guard in component state;
- suppression: never over a celebration or a care reaction.

The bubble anchors off `bonkContactFor` (tail toward the head, flipping
side for right-of-center heads), styled like the app's popovers. Under
reduced motion the fade animation is off but the bubble still shows —
bubbles are content, not decoration.

**Seasons.** Month-derived from the client clock with a deliberate
northern-hemisphere simplification (Dec-Feb winter, Mar-May spring, Jun-Aug
summer, Sep-Nov autumn — southern-hemisphere kandys experience an inverted
calendar; acceptable for a toy, revisit if anyone writes in). Implemented
exactly like the day/night layer: a tint gradient prepended over the
existing background plus seeded particles (rand stream 17) over the props —
winter snowflakes + white ground drifts, spring petals, summer warm wash
(+ pulsing fireflies at night), autumn falling leaves. Particle drift loops
are transform-only on wrappers with no base transform (the layering rule);
reduced motion leaves static particles. Celestial/transcendent phases (4-5)
get only the subtlest tint and never particles — space has no weather.

**Arrival greeting.** A `kandev-kandy-last-seen` localStorage stamp updates
on a ~1min tick while the widget is mounted; a mount after a 6h+ gap arms a
pending greeting consumed by the next dialog open: the wave-ish hop (the
celebration hop on the animation-safe wrapper), two golden motion arcs by
its head, the chip's small hop, and a time-appropriate greeting line.
A fresh install (no stamp) doesn't greet; broken storage degrades to
"never greet", not a crash.

## 13. Token Grotto (v0.11.0)

Kandy observes typed `session_prompt_usage.updated.*` events and keeps only
lifetime aggregates: one total, one counter per agent adapter, and one counter
per adapter/model pair. It stores no per-event history. Aggregate cardinality
is intentionally uncapped because every genuinely used adapter/model chamber
belongs to Kandy's history; repeated events only update existing counters, so
storage growth follows distinct adapter/model pairs rather than workload size.

Kandev's stable delivery `EventID` is hashed for practical idempotency. The
most recent 512 keys survive restarts and cover normal retries, including
ambiguous Host-state writes. Distinct event IDs remain distinct even when
their aggregate usage bodies match. Without an authoritative usage reader or
cursor, a replay older than the window can count again and missed events cannot
be reconciled; UI and README describe history as observed, never complete.

Positive `total_tokens` wins. Missing or zero total falls back to input plus
output without adding cache or thought categories whose semantics may overlap.
Estimated/fallback usage and recognized events with malformed, missing, zero,
or otherwise unusable counts latch the vault partial. Rejected payloads are
never persisted. The event identifies agent adapter and model but carries no
authoritative provider, so chambers are explicitly adapter/model breakdowns;
provider breakdown remains unavailable until Kandev adds a typed field.
