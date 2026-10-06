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

The manifest requires Kandev 0.83.0 or newer. It declares instance state,
encrypted host secrets, and event subscriptions. Kandy has no setup form and
does not ask for provider credentials. The host `Action` is optional at
runtime: newer hosts use it for the top-bar control, while older supported
hosts keep the native-button fallback. The source SDK pin below identifies the
build contract; it does not change the runtime minimum.

The package includes binaries for Linux amd64/arm64, macOS amd64/arm64, and
Windows amd64. `make package-host` builds only for the current machine;
`make package` builds every declared platform.

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
only for day/night and sleep, and calls only Kandy's Kandev-hosted webhooks; it
has no external service or analytics integration.

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

## Development

Kandy uses the Go SDK from a private sibling checkout of the Kandev monorepo.
`.kandev-sdk-ref` pins that source to
`e43881c7555372897b57ec51c705f1e05da43c40` (released Kandev v0.97.0), which contains the additive
`host.ui.Action` API. The Go `replace` path expects the plugin and Kandev
checkouts to be siblings:

```sh
mkdir plugin-work && cd plugin-work
git clone https://github.com/kdlbs/kandev.git kandev
git clone https://github.com/kdlbs/kandev-plugin-kandy.git kandev-plugin-kandy
git -C kandev checkout "$(cat kandev-plugin-kandy/.kandev-sdk-ref)"
cd kandev-plugin-kandy

go mod tidy
git diff --exit-code -- go.mod go.sum
make check-format
make vet
make test
make build
make package-host
make package
make audit-package
```

Use Go 1.26.8 and Node 24. The hand-written `ui/bundle.js` has no build step
or frontend dependencies. `make test` runs Go tests, UI interaction tests,
and positive and negative package/release verifier checks. `make smoke-package`
opens the packaged UI bundle in a disposable Chrome fixture. It checks the
Action and older-host paths on desktop and phone sizes. It exercises the
package contract but does not replace validation in a Kandev host.

`make audit-package` scans every binary in the verified package, including its
compiled Go standard library. CI and releases enforce this check; a source
scan alone can miss an older compiler embedded in an artifact.

For host integration, `scripts/smoke-real-host.mjs` launches a disposable
Kandev backend, installs the built package through Settings, and tests the
actual chat top bar and phone control with a disposable task and fake Kandy
webhook responses. The task uses Kandev's local E2E mock-agent; the smoke uses
no external provider account or personal data. The
SDK-pin host also has a phone plugin menu. v0.83.0 predates it, so that host's
phone check uses the legacy top-bar button. Both checks require a 44px target. The
script also checks hover/focus preview, Enter/Space and touch activation,
reduced motion, one registration after disable/re-enable, coarse-pointer input,
artwork containment, and horizontal overflow. It writes
`result.json`, measured control geometry, host logs, and screenshots to each
artifacts directory. Run it on Node 24 after building the two host revisions
and installing the locked web dependencies and Playwright Chromium:

```sh
mkdir -p "${XDG_CACHE_HOME:-$HOME/.cache}"
SMOKE_ROOT="$(mktemp -d "${XDG_CACHE_HOME:-$HOME/.cache}/kandy-host-smoke.XXXXXX")"
HOST_ROOT="$SMOKE_ROOT/hosts/kandev"
mkdir -p "$SMOKE_ROOT/hosts"
git clone https://github.com/kdlbs/kandev.git "$HOST_ROOT"
git -C "$HOST_ROOT" checkout --detach e43881c7555372897b57ec51c705f1e05da43c40
git -C "$HOST_ROOT" worktree add --detach "$SMOKE_ROOT/hosts/kandev-min" v0.83.0

for checkout in "$HOST_ROOT" "$SMOKE_ROOT/hosts/kandev-min"; do
  (cd "$checkout/apps" && corepack enable && pnpm install --frozen-lockfile)
  (cd "$checkout/apps/web" && pnpm exec playwright install chromium)
  (cd "$checkout" && make build)
done

mkdir -p "$SMOKE_ROOT/runtime"
VERSION="$(sed -n 's/^VERSION := //p' Makefile)"
PACKAGE="kandev-plugin-kandy-$VERSION.tar.gz"
make package-host
TMPDIR="$SMOKE_ROOT/runtime" node scripts/smoke-real-host.mjs \
  "$HOST_ROOT" "$PACKAGE" action 18431 "$SMOKE_ROOT/action"
TMPDIR="$SMOKE_ROOT/runtime" node scripts/smoke-real-host.mjs \
  "$SMOKE_ROOT/hosts/kandev-min" "$PACKAGE" legacy 18432 "$SMOKE_ROOT/minimum"
```

Use an available pair of ports. The smoke host uses isolated home and database
directories and deletes them when each run ends. Screenshots and JSON
measurements remain in the artifacts directories under `SMOKE_ROOT`.

To validate a published runtime, use its released full bundle as the host. The
source checkout supplies the release's locked Playwright dependency and a
test-only mock agent. The host executable and UI still come from the downloaded
runtime bundle. This example pins Kandev `v0.97.0` to commit
`e43881c7555372897b57ec51c705f1e05da43c40`:

```sh
RELEASE_ROOT="$SMOKE_ROOT/releases/v0.97.0"
SOURCE_ROOT="$SMOKE_ROOT/hosts/kandev-v0.97.0-source"
mkdir -p "$RELEASE_ROOT/download"
curl -fL https://github.com/kdlbs/kandev/releases/download/v0.97.0/kandev-linux-x64-full.tar.gz \
  -o "$RELEASE_ROOT/download/kandev-linux-x64-full.tar.gz"
curl -fsSL https://github.com/kdlbs/kandev/releases/download/v0.97.0/kandev-linux-x64-full.tar.gz.sha256 \
  -o "$RELEASE_ROOT/download/kandev-linux-x64-full.tar.gz.sha256"
(cd "$RELEASE_ROOT/download" && sha256sum -c kandev-linux-x64-full.tar.gz.sha256)
mkdir -p "$RELEASE_ROOT/runtime"
tar -xzf "$RELEASE_ROOT/download/kandev-linux-x64-full.tar.gz" -C "$RELEASE_ROOT/runtime"
cp -a "$RELEASE_ROOT/runtime/kandev" "$RELEASE_ROOT/runtime/kandev-smoke"
RUNTIME_ROOT="$RELEASE_ROOT/runtime/kandev-smoke"

git clone --filter=blob:none --no-checkout https://github.com/kdlbs/kandev.git "$SOURCE_ROOT"
git -C "$SOURCE_ROOT" fetch --depth=1 origin e43881c7555372897b57ec51c705f1e05da43c40
git -C "$SOURCE_ROOT" checkout --detach e43881c7555372897b57ec51c705f1e05da43c40
(cd "$SOURCE_ROOT/apps" && corepack enable && pnpm install --frozen-lockfile --filter @kandev/web...)
(cd "$SOURCE_ROOT/apps/backend" && GOWORK=off go build -o "$RUNTIME_ROOT/bin/mock-agent" ./cmd/mock-agent)
(
  export PLAYWRIGHT_BROWSERS_PATH="$SMOKE_ROOT/playwright-browsers"
  cd "$SOURCE_ROOT/apps/web"
  pnpm exec playwright install chromium
)

KANDEV_SMOKE_RUNTIME_BIN="$RUNTIME_ROOT/bin/kandev" \
KANDEV_SMOKE_HOST_REVISION=e43881c7555372897b57ec51c705f1e05da43c40 \
KANDEV_SMOKE_HOST_TAG=v0.97.0 \
KANDEV_SMOKE_EXPECT_VERSION=v0.97.0 \
KANDEV_SMOKE_PLAYWRIGHT_PACKAGE_JSON="$SOURCE_ROOT/apps/web/package.json" \
PLAYWRIGHT_BROWSERS_PATH="$SMOKE_ROOT/playwright-browsers" TMPDIR="$SMOKE_ROOT/runtime" \
  node scripts/smoke-real-host.mjs "$RUNTIME_ROOT" "$PACKAGE" \
    action 18431 "$RELEASE_ROOT/artifacts/action"
```

The release-runtime mode checks `/health` against the expected version before
installing the package. It records host revision/version, package SHA-256,
host executable and mock-agent helper SHA-256, desktop and coarse-pointer
measurements, overflow checks, host logs, and screenshots in the selected
artifact directory.

## Automation and releases

Pull requests to `master` run separate verification and packaging workflows.
They pin the Kandev source checkout, check module tidiness and formatting, run
`go vet` and tests, and build and verify the host-only and all-platform
packages. Package verification checks the manifest identity and version,
declared binaries, exact file inventory, and every SHA-256 checksum.

The `release` workflow runs from `master`. It validates the candidate, runs
backend and UI checks, and verifies the package before it pushes release
metadata or a tag. A pushed `v*` tag passes through the same checks before the
workflow publishes a GitHub Release with the package and `checksums.txt`.
Prerelease versions remain valid in both the manifest/Makefile match and tag
validation.

## Troubleshooting

- If `go test` cannot resolve `github.com/kandev/kandev`, check that the host
  checkout is beside the plugin and is at `.kandev-sdk-ref`.
- If packaging reports a missing runtime executable, check that the build
  platform is declared in `manifest.yaml`, then run `make clean` and retry.
- `make smoke-package` requires Chrome or Chromium. Set `CHROME_BIN` if the
  browser executable is not named `google-chrome`.

## State

Two aggregate JSON ledgers in kandev Host state (scope `instance`) participate
in kandev backups, survive plugin upgrades, and are removed on uninstall.
Uninstalling the plugin is, in the kindest possible terms, the end of that
kandy's story and its Token Grotto.

## License

This repository has no license file or declared GitHub license. The manifest's
author field gives attribution; it does not grant reuse rights.
