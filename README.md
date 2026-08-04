# Kandy

A tiny creature that **grows as your agents work**. It lives in the session
top bar and feeds on agent runs, turns, and conversation — evolving forever
as real work happens in your kandev instance. The kandy grows through
endless procedurally generated forms, scenes, and stage names. It starts as
an egg. It never stops.

- **Top bar**: a small creature portrait next to the session controls,
  updating live as work lands (no page reload needed).
- **Hover or click/tap**: the kandy card — its current scene, the creature
  with idle animations, its stage name, an XP bar, and a mood badge
  (Happy, Bored, Gloomy, ...).
- **Photo Booth**: click/tap the kandy, then use the camera icon at the
  card's top-right to frame its current appearance, habitat and time of day,
  stage name, level, mood, and bond as a polished portrait. Copy the crisp
  PNG directly to your clipboard. Rendering and copying happen entirely in
  your browser — nothing is uploaded, and no surrounding task or app UI
  enters the image. On plain-HTTP deployments, Kandy uses the browser's
  native image-copy path when available.
- **Token Grotto**: ask Kandy to show its grotto and it walks off the card,
  then walks back in along the water into an underground hub. Each agent CLI/adapter has a chamber;
  each model used through that adapter has a pile of stones on the chamber floor.
  Larger piles mean more observed tokens. Hover, focus, or tap a pile for its
  exact lifetime count. A chamber floor holds ten piles: the biggest and the
  most recently used models get a spot, and anything left over is merged into
  one pile that opens into a list.
- **Moods**: it celebrates when XP lands and gets bored, sad, and eventually
  gloomy (rain cloud included) when nothing ships for days.
- **Care**: left-click drops it a treat; right-click dumps a bucket of cold
  water on it. Neither ever feeds it — only real work does — but it
  remembers how you treat it, and how you treat it shapes how it grows up.
  A row of bond hearts on the card shows how much it trusts you — and a
  heart can crack in a way that never quite heals. Affection also fades if
  you stop visiting: a neglected bond drifts back to neutral, though it
  never sours into distrust. Be kind. Or don't, and live with what you
  raise.
- **Day and night**: scenes follow your local clock, and every kandy has its
  own bedtime — at night it sleeps in the top bar, and waking it is on your
  conscience.
- **Seasons**: the scene follows the calendar too — snow drifts in winter,
  petals in spring, fireflies on summer nights, falling leaves in autumn.
- **It talks**: a speech bubble occasionally appears while the card is open —
  dry, deadpan, and shaped by how it's been treated. A beloved kandy is warm;
  a wary one is passive-aggressive; a fearful one is quiet and a little
  heartbreaking. It greets you when you open its card, notices when you've
  been gone a while, has opinions about 2am deploys, and occasionally talks
  in its sleep.
- **How XP works**: it's a secret. The recipe lives server-side and the UI is
  never told the breakdown — your kandy simply reacts to how much real work
  flows through the instance.

## Screenshots

The first week — an egg hatches and starts to grow:

![Your first week](https://raw.githubusercontent.com/kdlbs/kandev-plugin-kandy/a228250c2914897a58182fe4e502dc39a6303559/first-week-light.png)

At night, it sleeps:

![Fast asleep](https://raw.githubusercontent.com/kdlbs/kandev-plugin-kandy/a228250c2914897a58182fe4e502dc39a6303559/night-light.png)

What it grows into — the species your install rolls, the places it lives,
what it looks like months from now — is yours to find out. Ship and see.

## Install

Build a package (`make package-host` for your platform, `make package` for
all platforms) and install the tarball via **Settings > Plugins > Install**
or `POST /api/plugins/install`.

## How it works and what it reads

Kandy is a visual, instance-wide companion. It does not call an agent, read a
conversation, or analyze work. Kandev sends it three activity notifications
for private XP bookkeeping:

- a message was added;
- an agent turn completed; or
- an agent run completed.

For those three notifications, Kandy still uses only the event type. The XP
recipe and activity counters remain private and unchanged.

Kandev also sends the typed per-session
`session_prompt_usage.updated.*` event. Kandy reads only this aggregate usage
metadata:

- source timestamp;
- delivery ID, or task/session/lifecycle agent IDs when no delivery ID exists,
  transiently and only to construct a duplicate-suppression key;
- agent type (the CLI/adapter slug, such as `claude-acp` or `codex-acp`);
- observed model name; and
- input, output, cache-read, cache-write, thought, and total token integers,
  plus the whole-record `estimated` flag.

Kandy prefers a positive observed `total_tokens` (which some adapters or
Kandev may infer). When total is missing or zero, it uses positive input plus
output only; Kandy itself never adds cache or thought tokens on top of a
reported total. Fallback, estimated, malformed, missing, or otherwise unusable
usage marks the grotto partial without storing the rejected payload. Missing
agent/model names enter explicit Mystery buckets. Chambers identify the agent
CLI/adapter, not necessarily the model provider, configured profile, person,
or agent run. Kandev v0.83.0 exposes no authoritative provider field on this
typed event, so provider breakdown is unavailable. Aliases and renamed models
remain separate piles.

**Chambers are not directly comparable across agents.** Whether the upstream
`total_tokens` folds in cache read/write tokens is decided by each agent
adapter before Kandev ever publishes the event, and it is not uniform: some
adapters report a `total` that already includes cache tokens, others report
cache-excluded totals or omit cache fields entirely, and at least one adapter
has no per-turn usage frame at all and emits an `estimated` cumulative
occupancy-delta approximation instead. Kandy has no adapter-agnostic signal to
normalize this, so it stores and displays whatever total each event reports
verbatim, and the grotto UI calls this out rather than implying the totals
share a unit.

The task/session/lifecycle IDs and usage categories are never persisted,
logged, or returned to the browser. Only a SHA-256 delivery-ID digest (or a
canonical aggregate-body digest when delivery ID is absent) survives for
practical duplicate suppression. Kandy never reads or stores
message text, prompts, responses, reasoning, tool calls, files, credentials,
or provider-reported cost. The top-bar UI listens for session updates only to
know when to refetch Kandy's own webhook. One Kandy and one grotto are shared by
the whole Kandev instance, rather than being tied to a person, task, agent, or
session.

The plugin stores two instance-scoped aggregate ledgers in Kandev Host state.
The existing creature ledger keeps XP/activity counts, timestamps, appearance
seed, and care temperament. The separate `kandy-token-grotto` ledger keeps the
Kandy lineage, observation boundary, exact decimal-string lifetime total, one
counter per distinct agent type/model pair, the source timestamp of each pair's
most recent observation, a partial-data flag, and the most
recent 512 duplicate-suppression keys. The per-model timestamp exists so a
chamber can stand its most recently used models on the floor beside its
biggest ones; it records when a model was last observed, never what it did. Repeated usage updates existing counters;
no per-turn history is stored. Storage therefore grows with genuinely distinct
adapter/model pairs, not event count; distinct aggregates have no artificial
cap because each chamber is part of Kandy's history.

Both ledgers use domain-separated HMAC-SHA256 signatures backed by one key in
kandev's encrypted secrets vault. Grotto corruption restarts only token history;
it cannot counterfeit or rebirth Kandy. The browser UI uses the local clock
only for day/night and sleep, and calls only Kandy's Kandev-hosted webhooks; it
has no external service or analytics integration.

Kandy does not use, request, or spend LLM tokens. It observes aggregate usage
reported by existing agent work and adds no model calls. Token count is not
price, billing history, quota, or cost; Kandy ignores monetary fields and
never estimates a price.

## Token-Grotto boundary and lifecycle

“Tokens in this grotto” means valid usage events Kandy caught after grotto
observation began. There is no supported usage reader or cursor for backfill
or reconciliation in Kandev v0.83.0, so the first iteration is deliberately
best effort. Events can be missed while the plugin is disabled, restarting,
overloaded, or when an agent reports no usable usage. Missing or unusable usage
marks the history partial. Delivery retries are suppressed by stable Kandev
event ID within the most recent 512 keys, including across plugin restarts;
distinct delivery IDs count as distinct observations even when their aggregate
usage bodies match. A replay older than that rolling window can count again.
The grotto says “observed” and never claims complete billing or lifetime history
before its displayed start date.

Host state participates in Kandev database backup/restore and survives plugin
restart and upgrade. Disabling preserves captured history but misses events.
There is no dedicated grotto export/reset UI in this iteration. A new Kandy
lineage starts an empty grotto; rollback ignores the separate state; re-upgrade
resumes it when lineage still matches. Uninstall removes the Kandy and ends
its grotto history.

## Development

Developed against a local checkout of the kandev monorepo (see the
`replace` directive in `go.mod`).

```sh
make test        # Go unit tests + dependency-free UI render/clipboard tests
make fmt vet     # gofmt + go vet
make package-host
```

## Automation and releases

Pull requests to `master` run separate verification and packaging workflows.
They check module tidiness, formatting, `go vet`, tests, a host build, and a
cross-platform package build. Pushing a `v*` tag verifies the plugin, builds
the all-platform package, and publishes a GitHub Release with the package and
its `checksums.txt` asset.

## State

Two aggregate JSON ledgers in kandev Host state (scope `instance`) participate
in kandev backups, survive plugin upgrades, and are removed on uninstall.
Uninstalling the plugin is, in the kindest possible terms, the end of that
kandy's story and its Token Grotto.
