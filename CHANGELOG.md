# Changelog

## [0.13.0] - 2026-08-10

### Changed

- chore(release): park the version on the prerelease convention (a89f5a1)
- feat: the arc closes at the top of the band, and begins again (#18) (a6586ee)
- fix: never hold the plugin lock across a host RPC (#17) (8c1da93)


### Added

- **The cycle.** Level 100 is now the top of the arc rather than the point
  where the designed band simply runs out. A kandy that reaches it **rests
  there**, fully grown, for a whole level's worth of XP (~53k, about a month
  at the measured pace) — two and a half years of raising it earn a victory
  lap. What happens when it grows past even that is left for you to find out
  in your own instance; this entry deliberately does not spoil it. Nothing is
  lost when it happens, and no progression gets faster or slower.
- The state and behaviour it relies on, for operators and reviewers:
  - the ledger gains a small sealed lineage record (a generation counter, a
    capped list of at most 8 retired creatures, and the salt that pins the
    scene's biome to the lineage rather than to one creature);
  - XP, the level curve and the XP recipe are completely unchanged — no
    prestige multiplier, no carried head start, no scaling by generation;
  - the Token Grotto is keyed by lineage, so a lineage change starts a new
    one, as its "history follows the lineage" rule already documented;
  - care state is unaffected by any of this: pets and bonks still never
    touch XP, and so can never trigger the transition.
- `genlineage` dev subcommand: walks a lineage through the whole arc and emits
  the real webhook payloads, for offline rendering.

### Security

- Ledger seal bumped to v2 for the new fields. A genuine v1 signature is
  verified against the v1 scheme and re-sealed at v2 on first load — existing
  installs migrate silently and are never mistaken for tampering. Lineage
  fields found on a v1 ledger are dropped rather than adopted, since a v1
  signature never covered them.

### Fixed

- Kandy can no longer go unresponsive and wedge the Kandev host. Every handler
  used to serialize on one mutex that was held across Host round-trips, so a
  single slow Host call stopped the plugin answering events, webhook polls and
  the health check at once — the state Kandev reports as `status: error`, where
  it can neither disable the plugin nor shut down cleanly.
- The in-memory lock now covers ledger mutation only and is never held across a
  Host RPC. XP is applied in memory; a single background writer coalesces the
  persists, so a mutator waits for its own write at most, never for the backlog.
- Webhook reads (the UI's 1-3s poll, pet and bonk) serve from an in-memory
  snapshot: once warm, the read path makes no Host call at all and cannot queue
  behind an event's persist.
- Every Host round-trip now runs under a 4s timeout, so a stalled Kandev can
  park a plugin goroutine for a bounded time and no longer.
- The ledger HMAC key is memoized for the process lifetime instead of costing a
  secrets round-trip on every XP award; only a failed fetch is retried.

XP values, the no-XP-for-task-creation rule and OnEvent's always-return-nil
contract (a retried delivery would double-award) are unchanged.

## [0.12.0] - 2026-08-08

### Changed

- Fix release workflow prerelease parsing (#16) (b9bf87b)
- feat(grotto): add observed token history (#15) (88dfba5)


## [0.11.0] - 2026-08-02

### Added

- Add Kandy's underground Token Grotto with lifetime agent-adapter chambers and model piles.
- Collect privacy-limited aggregate token usage from Kandev's typed prompt-usage event with bounded duplicate suppression.
- Stand chamber piles on fixed floor spots, ranked by size and recency, and merge the overflow into one pile that opens into a list.

## [0.9.4] - 2026-08-01

### Changed

- chore(security): bump x/net & x/text, pin CI actions to commit SHA (#4) (e2e2c4c)


## [0.9.3] - 2026-08-01

### Changed

- fix: prevent Kandy info hover clipping (#9) (03bbf4e)
- Add Kandy repository URL to manifest (#8) (2660b99)


## [0.9.2] - 2026-08-01

### Changed

- feat(ui): add Kandy mechanics helper (#6) (d99de9a)


## [0.9.1] - 2026-08-01

### Changed

- ci: add manual release workflow (#7) (bacb814)
- fix: align kandy topbar control (#5) (c1ce4ae)
