# Kandy repository workflow

Kandy is a production Kandev runtime plugin. Read the current public
[plugin authoring guide](https://github.com/kdlbs/kandev/blob/main/docs/public/plugins-authoring.md)
and use Kandev's
[create-kandev-plugin workflow](https://github.com/kdlbs/kandev/blob/main/.agents/skills/create-kandev-plugin/SKILL.md).

- Go SDK: exact `github.com/kdlbs/kandev/pluginsdk v0.1.0`; no backend module
  requirement, SDK `replace`, or sibling source dependency in the plugin module.
- SDK and plugin versions are independent. Read the installed SDK's
  `sdk-release.json` before changing `min_kandev_version`; retain a supported
  `api_version`. Current floor: Kandev 0.99.0, API 1.
- Frontend: handwritten `ui/bundle.js`, no npm dependencies or build step.
  Run `node --test ui/bundle.test.js`; no typecheck script exists.
- Validate `go mod tidy` without module changes, `make sdk-check`,
  `make check-format`, `make vet`, `make test`, and `make build`.
- Packaging separately needs an explicit `KANDEV_TOOLING` checkout matching
  `.kandev-tooling-ref`, with `apps/backend` and root `pluginsdk/`.
  Run `make package-host`, `make package`, inspect inventory/checksums, then
  smoke-test the package on the declared minimum host. SDK compilation is
  standalone; packaging still needs backend-owned `plugin-pack`.
- Preserve manifest identity, author, API version, capabilities, webhooks,
  platforms, and existing feature behavior when migrating dependencies.
- Release/tag/catalog changes require an explicit release instruction.

See README.md for setup and docs/sdk-migration-validation.md for migration evidence.
