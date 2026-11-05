# Public SDK migration validation

The migration starts from Kandy master `f042b3fcc4ff198c9f48e5cbda45f6b21a70a057`.
The public `github.com/kdlbs/kandev/pluginsdk v0.1.0` release resolves to
`f0e2e774cfe2df8a0d15e4c21dea7b48580e38fb`. Its installed `sdk-release.json`
records host release and minimum `0.99.0`, API versions `[1,2]`. Kandy retains
API 1, plugin version 0.15.0, permissions, webhooks, UI bundle, and platforms.

There is no npm SDK consumer, package manifest, frontend lockfile, generated
protocol import, or frontend typecheck command. UI verification uses the actual
Node test suite. `plugin-pack` remains separately pinned backend tooling and
is not a plugin module dependency.

Validation results will be recorded here before requesting review.
