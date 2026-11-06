# Public SDK migration validation

Validated on Linux amd64 with Go 1.26.6 and Node 24.19.0 on 2026-11-05/06.
The migration starts from Kandy master `f042b3fcc4ff198c9f48e5cbda45f6b21a70a057`.
The public `github.com/kdlbs/kandev/pluginsdk v0.1.0` release resolves to
`f0e2e774cfe2df8a0d15e4c21dea7b48580e38fb`. Its installed `sdk-release.json`
records host release and minimum `0.99.0`, API versions `[1,2]`. Kandy retains
API 1, plugin version 0.15.0, permissions, webhooks, UI bundle, and platforms.
Previously published binaries keep their own manifest/runtime contract; newly
built packages deliberately raise the host minimum from 0.83.0 to 0.99.0.

There is no npm SDK consumer, package manifest, frontend lockfile, generated
protocol import, or frontend typecheck command in Kandy. No npm dependency was
added. UI verification uses the actual Node test suite.

## Standalone source and public resolution

A fresh clone at `/tmp/kandy-standalone.L8Uoz9/plugin` has only `plugin/` in
its parent directory, with no SDK or tooling sibling. Source revision:
`6e4d0ef47796ba4838dc0c9163b9d8ebd23ea6e2`. The module cache is outside that
checkout. The initial download used an empty module cache with public proxy and
checksum verification, without private-module exemptions:

```sh
export GOWORK=off
export GOPROXY=https://proxy.golang.org GOSUMDB=sum.golang.org
export GOPRIVATE= GONOPROXY= GONOSUMDB=
export GOMODCACHE=/tmp/kandy-sdk-migration-evidence/public-modcache
go mod download
go mod verify
go mod tidy
git diff --exit-code -- go.mod go.sum
go list -m all
go list -m -json github.com/kdlbs/kandev/pluginsdk
make sdk-check
make check-format
make vet
make test
make build
git status --short
```

All completed successfully; module files and the fresh checkout stayed clean.
The selected public SDK is v0.1.0, with no replacement, and its checksum is
`h1:Pov5zE2gGf53FslhpcoGgx6E3nu6kjizT69x3MlEEEs=`. The backend module is
absent from the plugin module graph. `make sdk-check` reported
`SDK 0.1.0: compatible (minimum Kandev 0.99.0)`.

`make test` ran `go test ./server/... -count=1`,
`node --test ui/bundle.test.js` (98 passed, none skipped),
`sh scripts/test-verify-package.sh`, and
`sh scripts/test-verify-release-version.sh`. Both shell suites passed their
positive and negative checks. They cover normalized YAML from the pinned tool,
pruned host manifests, full-platform declarations, inventory, corruption, and
release version matching. Regression fixtures first failed against the old
verifiers, then passed after the verifier updates.

The pre-migration baseline failed because `../kandev/apps/backend` was absent,
which is the source dependency removed by this migration. One early test run
under simultaneous cross-build load failed the existing 20 ms webhook timing
assertion at 35.8 ms in
`TestLockDiscipline_ConcurrentTokenUsageKeepsTotalsExact`. The unchanged suite
passed on retry and in the final isolated checkout; no threshold was relaxed.

## Packaging and archive inspection

Packaging remains dependent on backend-owned `plugin-pack`, invoked in its own
module. The explicit tooling checkout is
`/tmp/kandy-sdk-migration-evidence/tooling`, pinned by `.kandev-tooling-ref` to
`f0e2e774cfe2df8a0d15e4c21dea7b48580e38fb`. It includes `apps/backend` and
root `pluginsdk/` for the backend's own replacement. Kandy's SDK dependency
continues to resolve publicly. This is not checkout-free packaging.

From fresh standalone checkout
`/tmp/kandy-sdk-migration-evidence/standalone`, these commands passed:

```sh
export GOWORK=off
export GOMODCACHE=/tmp/kandy-sdk-migration-evidence/public-modcache
export KANDEV_TOOLING=/tmp/kandy-sdk-migration-evidence/tooling
make package-host
sh scripts/verify-release-version.sh v0.15.0 kandev-plugin-kandy-0.15.0.tar.gz
tar -tzf kandev-plugin-kandy-0.15.0.tar.gz
CGO_ENABLED=0 make package
sh scripts/verify-release-version.sh v0.15.0 kandev-plugin-kandy-0.15.0.tar.gz
tar -tzf kandev-plugin-kandy-0.15.0.tar.gz
sha256sum kandev-plugin-kandy-0.15.0.tar.gz
```

Both targets verified exact inventory and every internal checksum. The full
archive contains `manifest.yaml`, `README.md`, `ui/bundle.js`, `checksums.txt`,
and the five declared binaries: Linux amd64/arm64, macOS amd64/arm64, Windows
amd64. Binary headers were inspected as ELF, Mach-O and PE respectively.
`go version -m` on the extracted Linux binary confirms public SDK v0.1.0,
no replacement, `CGO_ENABLED=0`, and source revision
`aaeb71e20854b65f41d2b965247432118a762c3c` (later commits affect evidence and
shell formatting only).

Full archive SHA-256:
`808ae47eaf82687a96d45ae31b87c03b14665c15f513e272dbdb076ba6c60193`.
The initial local cross-build attempted cross-CGO with the native assembler
and failed on arm64; explicitly setting `CGO_ENABLED=0` completed all targets.
Only the Linux amd64 executable was run; the other four were cross-built and
inspected.

## Packaged UI and released minimum host

The following fixture passed against the full archive:

```sh
CHROME_BIN=/tmp/kandy-sdk-migration-evidence/chrome \
  node scripts/smoke-package-ui.js kandev-plugin-kandy-0.15.0.tar.gz
```

It covers desktop and phone Action/legacy behavior, repeat initialization,
coarse pointer input and reduced motion. Machine-readable results are in
[the packaged UI record](validation/sdk-v0.1.0-package-ui.json).

The official `v0.99.0` `kandev-linux-x64-full.tar.gz` release archive was
fetched with `gh release download`, verified with its published `.sha256`, and
extracted into `/tmp/kandy-sdk-migration-evidence/runtime/kandev`. The runtime
and web UI come from that release; only the `mock-agent` test helper was built
from exact-release source, using:

```sh
cd /tmp/kandy-sdk-migration-evidence/tooling/apps
pnpm install --frozen-lockfile --filter @kandev/web...
cd backend
GOWORK=off go build \
  -o /tmp/kandy-sdk-migration-evidence/runtime/kandev/bin/mock-agent ./cmd/mock-agent
```

The source checkout supplies the locked Playwright package. The test uses an
existing Playwright Chromium 149 executable via `CHROME_BIN`. The local wrapper
sets `LD_LIBRARY_PATH` to the installed Nix browser libraries, then execs
the installed Playwright Chromium executable with the original arguments.
A short task-owned `TMPDIR` avoids Chromium's Unix-socket
path limit. Initial browser attempts failed for missing libraries and an
oversized temporary path; a full-package attempt later hit a navigation timeout
under machine load. The final unchanged smoke command completed successfully:

```sh
KANDEV_SMOKE_RUNTIME_BIN=/tmp/kandy-sdk-migration-evidence/runtime/kandev/bin/kandev \
KANDEV_SMOKE_HOST_REVISION=f0e2e774cfe2df8a0d15e4c21dea7b48580e38fb \
KANDEV_SMOKE_HOST_TAG=v0.99.0 KANDEV_SMOKE_EXPECT_VERSION=v0.99.0 \
KANDEV_SMOKE_PLAYWRIGHT_PACKAGE_JSON=/tmp/kandy-sdk-migration-evidence/tooling/apps/web/package.json \
CHROME_BIN=/tmp/kandy-sdk-migration-evidence/chrome TMPDIR=/tmp/kdy \
node scripts/smoke-real-host.mjs \
  /tmp/kandy-sdk-migration-evidence/runtime/kandev \
  /tmp/kandy-sdk-migration-evidence/standalone/kandev-plugin-kandy-0.15.0.tar.gz \
  action 18431 /tmp/kandy-sdk-migration-evidence/minimum-host-full
```

The runner passes an explicit child environment with isolated HOME/XDG,
config, data, database and repository paths, and loopback binding. It does not
inherit `KANDEV_BUNDLE_DIR` or `KANDEV_VERSION`. `/health` was asserted to report
`v0.99.0` before installation. The released host executable SHA-256 is
`11133f4d27efac7259d6f3ff6f598e3b018eeb10e0976b5b931a2a77968d572d`.

The full-package run passed Settings upload/activation, actual GET `kandy`,
POST `pet` and `bonk`, undeclared and disabled webhook rejection, state and
vault-key recovery after restart, activity awards, and a real typed aggregate
usage event carrying 150 mock-agent tokens. Later UI checks use fake presentation
responses to exercise desktop hover/focus, keyboard/touch dialogs, reduced
motion, disable/re-enable without duplicate registration, phone controls,
artwork bounds and horizontal overflow. No external provider was called.

Exact host/runtime/package identity, backend results and geometry are in
[the minimum-host record](validation/sdk-v0.1.0-minimum-host.json). Screenshots
and full logs remain under `/tmp/kandy-sdk-migration-evidence/`; they are not
part of the plugin archive. The smoke exercises restart state preservation;
it does not certify every historical plugin upgrade or non-Linux runtime.

## Automated review follow-up

The package verifier now validates complete quoted/unquoted executable paths,
including rejection of trailing text and malformed extra host declarations.
The normalized-host negative case adds a separate unsupported platform without
removing the supported host. The normalized release fixture asserts its plain
version before archiving. `sh scripts/test-verify-package.sh` and
`sh scripts/test-verify-release-version.sh` passed after these changes.

`sh scripts/test-check-tooling.sh` passes clean, staged, unstaged, untracked,
wrong-revision and missing-directory cases using a disposable Git fixture.
It is included in `make test`. `make check-tooling` also passes against the
real pinned clean tooling checkout. The SDK checker's explicit v0.1.0 pin is
retained: its `internal/compatibility/resolve.go` resolves the project's selected
SDK with `go list -mod=readonly -m -json`, rather than checking its own module.
The minimum-host smoke now requires a positive decimal token count.

The stricter smoke was rerun successfully against the same full archive using
identical environment/arguments above, with output directed to
`/tmp/kandy-sdk-migration-evidence/minimum-host-review`. The committed machine
record was refreshed from that run and reports 150 observed tokens.
`make test` passed again with all 98 UI tests, backend tests, both package/release
verifier suites, and the new tooling-checkout suite. The real full archive also
passed the tightened `scripts/verify-package.sh` after remediation.
