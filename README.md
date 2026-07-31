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
- **Moods**: it celebrates when XP lands and gets bored, sad, and eventually
  gloomy (rain cloud included) when nothing ships for days.
- **Care**: left-click drops it a treat; right-click dumps a bucket of cold
  water on it. Neither ever feeds it — only real work does — but it
  remembers how you treat it, and how you treat it shapes how it grows up.
  A row of bond hearts on the card shows how much it trusts you — and a
  heart can crack in a way that never quite heals. Be kind. Or don't, and
  live with what you raise.
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
conversation, or analyze work. Kandev sends it three activity notifications:

- a message was added;
- an agent turn completed; or
- an agent run completed.

For each notification, Kandy uses only its type to update an aggregate XP
ledger. It deliberately does **not** inspect event payloads, so it does not
read message text, prompts, responses, tool calls, files, agent identity, or
session identity. The top-bar UI listens for session updates only to know when
to refresh its own card; it ignores the update data. One Kandy is shared by
the whole Kandev instance, rather than being tied to a person, task, agent, or
session.

The plugin stores one small instance-scoped ledger in Kandev Host state:
aggregate XP and activity counts, timestamps, a random appearance seed, and
the pet/bonk temperament state. It stores no conversation content or token
data. It also stores one integrity key in kandev's encrypted secrets vault,
used only to detect out-of-band edits to that ledger. Its browser UI uses the local clock only for the day/night scene and
sleep schedule, and calls only Kandy's own Kandev-hosted webhooks; it has no
external service or analytics integration.

Kandy does not use, request, or spend LLM tokens. Agent work can consume
tokens independently, but Kandy sees only the three completed activity
signals above—not token counts—and adds no model calls or token cost.

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

One small JSON ledger in kandev Host state (scope `instance`), so the kandy
participates in kandev backups, survives plugin upgrades, and is removed on
uninstall. Uninstalling the plugin is, in the kindest possible terms, the end
of that kandy's story.
