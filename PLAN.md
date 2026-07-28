# Kandev Gotchi — implementation plan

A Tamagotchi-style creature living in the `chat-top-bar` slot that evolves
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
K = 200, B = 1.75
```

- Level 1 at 0 XP; level 2 at 150 XP (~a light day: ~20 msgs + ~10 turns +
  2 agent runs ≈ 140 XP; one finished task alone is 150); level 3 at 412 XP
  (a solid day); level 10 ≈ 30.8k XP; level 20 ≈ 8.2M XP. Geometric growth
  stretches forever; float64 log stays finite and monotonic for any
  realistic xp, so there is no cap.
- Unit-tested properties: monotonic in xp, never NaN/Inf, `level(0) == 1`,
  progress always in `[0, 100)`, thresholds strictly increasing.

## 3. State & persistence

Host state (requires `capabilities.state: true`), scope `instance`,
scopeID `""`, key `gotchi` — one small JSON object, participates in kandev
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
id: kandev-plugin-gotchi | api_version: 1 | version: 0.1.0
display_name: "Kandev Gotchi" | categories: ["tools"]
runtime.type: binary (linux-amd64 for host loop; full package builds all 5)
capabilities:
  state: true
  events: [task.state_changed, turn.completed, agent.completed, message.added]
webhooks: [{ key: gotchi, method: GET }]
ui.bundle: /ui/bundle.js
config_schema: { debug: boolean, default false }
```

## 5. Webhook API (`GET .../webhooks/gotchi`)

Response — creature facts only, no factor breakdown:

```json
{ "level": 6, "tier": 1, "stage_name": "Mossy Sproutling",
  "progress_pct": 42.5, "appearance_seed": 987654321,
  "flavor": "Your gotchi looks energized.", "alive_since": "RFC3339" }
```

- `appearance_seed = fnv32(salt ":" level)` — deterministic per level per
  instance; changes on every evolution.
- `?debug_grant=<n>` (n in 1..10^9) adds n XP **only** when plugin config
  `debug == true`; otherwise responds 403 and grants nothing. Documented in
  README as a dev/demo knob.
- Flavor text: cryptic only, chosen deterministically from seeded word lists,
  with an activity overlay (recently fed vs. napping) derived from
  `updated_at` — never mentions factors or numbers.

## 6. Procedural evolution (deterministic, novel forever)

Everything derives from `(level, tier, appearance_seed)` via a mulberry32
seeded PRNG in the UI — **no `Math.random` at render time**, so no flicker.

- **Tier** = `floor((level-1)/5)` — a new era every 5 levels.
- **Scene background** per tier: 8 handcrafted scenes (meadow → forest →
  lake → mountain → city dusk → neon night → aurora → deep space) as CSS
  gradients + simple SVG props (grass blades, trees, stars…). Tiers beyond 7
  reuse the space scene with a seeded hue-rotation and star-count growth, so
  backgrounds keep shifting indefinitely.
- **Creature**: level 1 is an egg. From level 2 the body is a seeded blob
  (superellipse-ish path with seeded squash), with parts that *accumulate*:
  eyes (2), then mouth, blush, ears/antennae, spikes (count grows with
  level), stubby feet, tail, wings, crown/halo at high tiers. Part counts and
  offsets are seeded, palette comes from the tier with seeded hue jitter —
  tiered palettes + accumulating parts + seeded variation means every level
  looks stable but new, forever.
- **Stage name**: procedural `<adjective> <species>` — species word list
  indexed by tier (cycling with a "Cosmic/Elder/Mythic…" prefix ladder past
  the list end), adjective seeded per level. Level 1 is always "Egg".
  Generated server-side so name logic stays hidden and stable.

## 7. UI component structure (`ui/bundle.js`, no build step)

Plain ES module, `window.registerKandevPlugin("kandev-plugin-gotchi", ...)`,
`registry.registerComponent("chat-top-bar", ...)`, `host.React` + `host.jsx`
+ `host.ui` Tooltip/TooltipTrigger/TooltipContent (activity-rings pattern).

- Data: `host.api.fetch("webhooks/gotchi")` on mount, re-fetch on hover
  (mouseenter/focus) and a 60s interval (cleared on unmount).
- Trigger: ~24px mini creature SVG with subtle idle bob + periodic blink.
- TooltipContent card (~240px): scene background div, ~96px creature with
  idle bob / blink / occasional wiggle, stage name + "Lv N", XP bar
  (rounded track using `var(--muted)` / fill `var(--primary)`) with % to
  next evolution, flavor line. Theme vars where reasonable for light/dark.
- Animations: one injected `<style id="kandev-gotchi-style">` (guarded so
  repeat `initialize` is safe) with keyframes `gotchi-bob`, `gotchi-blink`,
  `gotchi-wiggle`; disabled under `prefers-reduced-motion: reduce`.
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
3. `PATCH /api/plugins/kandev-plugin-gotchi` config `{debug: true}`, then
   `?debug_grant` to jump to mid/high levels.
4. Screenshots to `/tmp/kandev-gotchi-demo/screenshots/`: top-bar icon in
   context (crop `[data-testid="task-topbar"]`), hover card at low level
   (egg), 2–3 progressively evolved levels (creature + scene + stage name +
   XP bar), one full page; light + dark (toggle `documentElement.classList`,
   no reload; tooltip located via `[data-slot="tooltip-content"]`).
