# Kandev Gotchi

A tiny creature that lives in the session top bar and **evolves forever** as
work happens in your kandev instance. Finish tasks, run agents, keep the
conversation going — the gotchi grows through endless procedurally generated
forms, scenes, and stage names. It starts as an egg. It never stops.

- **Top bar**: a ~24px animated creature next to the session controls.
- **Hover**: the gotchi card — its current scene (meadow → forest → … → deep
  space and beyond), the creature with idle animations, its stage name, and
  an XP bar showing progress to the next evolution.
- **How XP works**: it's a secret. The recipe lives server-side and the UI is
  never told the breakdown — your gotchi simply reacts to how much real work
  flows through the instance.

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

### Debug / demo knob

With the plugin config **Debug mode** enabled (Settings > Plugins > Kandev
Gotchi), the webhook accepts `?debug_grant=<n>` to add `n` XP (1..10^9) so
you can preview later evolution stages:

```sh
curl "http://localhost:8080/api/plugins/kandev-plugin-gotchi/webhooks/gotchi?debug_grant=100000"
```

With debug off (the default) the parameter is rejected with 403 and grants
nothing. There is intentionally no way to inspect or itemize XP sources.

## State

One small JSON ledger in kandev Host state (scope `instance`), so the gotchi
participates in kandev backups, survives plugin upgrades, and is removed on
uninstall. Uninstalling the plugin is, in the kindest possible terms, the end
of that gotchi's story.
