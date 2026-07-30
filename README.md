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

## Development

Developed against a local checkout of the kandev monorepo (see the
`replace` directive in `go.mod`).

```sh
make test        # Go unit tests (XP curve, event mapping, webhook shape)
make fmt vet     # gofmt + go vet
make package-host
```

## State

One small JSON ledger in kandev Host state (scope `instance`), so the kandy
participates in kandev backups, survives plugin upgrades, and is removed on
uninstall. Uninstalling the plugin is, in the kindest possible terms, the end
of that kandy's story.

