# Changelog

## [0.13.0] - 2026-08-09

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
