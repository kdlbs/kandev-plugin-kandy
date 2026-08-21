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
- **Kandy Jar (optional)**: pair this instance with a shared Kandy Jar server
  from the full Kandy dialog. Kandy publishes a deliberately small display
  snapshot for shared rooms and leaderboards; disconnecting revokes the
  publication and removes the local publisher credential.
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
- **The cycle**: **level 100** is the top of the arc, and your kandy rests
  there — fully grown, in its final form, for a whole level's worth of work.
  What happens when it finally outgrows even that is the one thing this
  README will not tell you. It takes about two and a half years to find out,
  and nothing is lost when you do.
- **How XP works**: it's a secret. The recipe lives server-side and the UI is
  never told the breakdown — your kandy simply reacts to how much real work
  flows through the instance.

## Screenshots

The first week — an egg hatches and starts to grow:

![Your first week](https://raw.githubusercontent.com/kdlbs/kandev-plugin-kandy/a228250c2914897a58182fe4e502dc39a6303559/first-week-light.png)

At night, it sleeps:

![Fast asleep](https://raw.githubusercontent.com/kdlbs/kandev-plugin-kandy/a228250c2914897a58182fe4e502dc39a6303559/night-light.png)

What it grows into — the species your install rolls, the places it lives,
what it looks like months from now, and what waits at the end of the arc —
is yours to find out. Ship and see.

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

- source timestamp, transiently for canonical duplicate suppression;
- task/session/lifecycle agent IDs, transiently and only to construct a
  duplicate-suppression key;
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

The task/session/lifecycle IDs, source timestamps, and usage categories are never persisted,
logged, or returned to the browser. Only a SHA-256 digest of the typed,
normalized aggregate body survives for practical duplicate suppression;
delivery EventID and OccurredAt are excluded, so transport retries with the
same body hash identically. Kandy never reads or stores
message text, prompts, responses, reasoning, tool calls, files, credentials,
or provider-reported cost. The top-bar UI listens for session updates only to
know when to refetch Kandy's own webhook. One Kandy and one grotto are shared by
the whole Kandev instance, rather than being tied to a person, task, agent, or
session.

The plugin stores two instance-scoped aggregate ledgers in Kandev Host state.
The existing creature ledger keeps XP/activity counts, timestamps, appearance
seed, and care temperament. The separate `kandy-token-grotto` ledger keeps the
Kandy lineage, observation boundary, exact decimal-string lifetime total, one
counter per distinct agent type/model pair, a monotonic per-model recency
ordinal used only for floor presentation, a partial-data flag, and the most
recent 512 duplicate-suppression keys. The ordinal contains no source time and
does not represent per-turn history. Repeated usage updates existing counters;
no per-turn history is stored. Storage therefore grows with genuinely distinct
adapter/model pairs, not event count; distinct aggregates have no artificial
cap because each chamber is part of Kandy's history.

Both ledgers use domain-separated HMAC-SHA256 signatures backed by one key in
kandev's encrypted secrets vault. Grotto corruption restarts only token history;
it cannot counterfeit or rebirth Kandy. The browser UI uses the local clock
only for day/night and sleep. It calls Kandy's authenticated Kandev-hosted
webhooks and the three declared, authenticated Kandy Jar actions; it never
contacts a Jar server directly. Kandy has no analytics integration.

Kandy does not use, request, or spend LLM tokens. It observes aggregate usage
reported by existing agent work and adds no model calls. Token count is not
price, billing history, quota, or cost; Kandy ignores monetary fields and
never estimates a price.

## Token-Grotto boundary and lifecycle

“Tokens in this grotto” means valid usage events Kandy caught after grotto
observation began. The boundary starts when the first valid event is observed;
rejected usage can mark the history partial but cannot start that boundary.
There is no supported usage reader or cursor for backfill
or reconciliation in Kandev v0.83.0, so the first iteration is deliberately
best effort. Events can be missed while the plugin is disabled, restarting,
overloaded, or when an agent reports no usable usage. Missing or unusable usage
marks the history partial. Delivery retries with the same normalized body are
suppressed within the most recent 512 keys, including across plugin restarts;
changed delivery IDs do not turn an identical body into a second observation.
A replay older than that rolling window can count again.
The grotto says “observed” and never claims complete billing or lifetime history
before its displayed start date.

Host state participates in Kandev database backup/restore and survives plugin
restart and upgrade. Disabling preserves captured history but misses events.
There is no dedicated grotto export/reset UI in this iteration. A new Kandy
lineage starts an empty grotto; rollback ignores the separate state; re-upgrade
resumes it when lineage still matches. Uninstall removes the Kandy and ends
its grotto history.

## Kandy Jar security and operation

Kandy Jar is opt-in. The plugin setting `jar_origin` defaults to
`https://jar.kandev.ai`; operators can point it at a self-hosted server. The
value must be an origin with no path, credentials, query, or fragment. HTTPS
is mandatory except for HTTP on a loopback address during local development.
The connect action never accepts an origin, and redirects are not followed.
Kandy requires Kandev 0.91.1 or later because that release restricts this
instance-global origin, plugin-management mutations, and Jar connect/disconnect
actions to administrators.

Pairing uses a one-time `KJ-XXXX-XXXX-XXXX` code. Kandy generates a random
publisher token locally and sends only its SHA-256 hash while redeeming that
code. The plaintext token is stored only in Kandev's encrypted secrets vault;
it is never returned to the browser, written to plugin state, or logged. The
vault record binds the token to the exact Jar origin, so a recovery credential
is never reused after an administrator changes servers. Ambiguous Host writes
retain that origin-bound credential until the exact sealed state can be
confirmed. Kandev authorizes connection changes before invoking the plugin:
authenticated members may inspect non-secret status, while administrators may
connect or disconnect the instance-wide publication. The connecting actor ID is
retained only as sealed audit metadata; it does not prevent another administrator
from recovering the connection.

Only an explicit allowlist of appearance and public progression fields is
published. It excludes XP, activity and care counters, raw temperament,
timestamps, task/session IDs, prompts, messages, agent/model/provider data,
Token Grotto usage, seals, and credentials. Ancestors are capped at eight and
use their own smaller allowlist. Snapshot requests are capped at 16 KiB.

Publishing uses a persisted revisioned outbox: an unacknowledged snapshot is
retried byte-for-byte, later changes are coalesced, and process restart resumes
the pending revision. The complete connection and outbox document is protected
by a domain-separated HMAC using Kandy's vault-backed integrity key. A missing
or invalid seal fails closed before the publisher credential is read or any
network request is made. Unsigned state from a pre-Jar development build is not
trusted automatically; an operator must remove that stale connection state and
pair again.

Disconnect first revokes the remote publication, then deletes the vault
credential and local connection state. Before uninstalling the plugin,
disconnect it (or remove the installation from the Jar server) so the public
snapshot is explicitly revoked.

## Development

Developed against a local checkout of the kandev monorepo (see the
`replace` directive in `go.mod`). Reproducible CI and release builds pin the
Kandev SDK to `85abe02e26e5853f1556056155c50d790192a964`, the action-access
security baseline intended for Kandev 0.91.1.

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
An optional Kandy Jar connection adds one non-secret instance-state document;
its publisher token lives separately in Kandev's encrypted secrets vault.
Uninstalling the plugin is, in the kindest possible terms, the end of that
kandy's story and its Token Grotto.
