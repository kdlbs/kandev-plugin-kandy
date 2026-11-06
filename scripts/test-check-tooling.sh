#!/bin/sh
set -eu

repo_dir=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
test_dir=$(mktemp -d "${TMPDIR:-/tmp}/kandy-tooling-test.XXXXXX")
trap 'rm -rf "$test_dir"' EXIT HUP INT TERM
tooling=$test_dir/tooling
fixture=$test_dir/plugin
mkdir -p "$tooling/apps/backend/cmd/plugin-pack" "$tooling/pluginsdk" "$fixture"
printf 'package main\n' > "$tooling/apps/backend/cmd/plugin-pack/main.go"
printf 'module fixture\n' > "$tooling/pluginsdk/go.mod"
git -C "$tooling" init -q
git -C "$tooling" config user.name 'Kandy tooling test'
git -C "$tooling" config user.email 'kandy-tooling@example.invalid'
git -C "$tooling" add .
git -C "$tooling" commit -qm 'seed tooling fixture'
git -C "$tooling" rev-parse HEAD > "$fixture/.kandev-tooling-ref"

check_tooling() {
	make -s -C "$fixture" -f "$repo_dir/Makefile" check-tooling "KANDEV_TOOLING=$tooling"
}

expect_failure() {
	if check_tooling > "$test_dir/output" 2>&1; then
		printf 'expected check-tooling to reject %s\n' "$1" >&2
		exit 1
	fi
	grep -F "$2" "$test_dir/output" >/dev/null || {
		cat "$test_dir/output" >&2
		exit 1
	}
}

check_tooling
printf '// dirty\n' >> "$tooling/apps/backend/cmd/plugin-pack/main.go"
expect_failure 'unstaged tooling edits' 'must be clean'
git -C "$tooling" add .
expect_failure 'staged tooling edits' 'must be clean'
git -C "$tooling" restore --staged --worktree .
printf 'untracked\n' > "$tooling/extra.go"
expect_failure 'untracked tooling source' 'must be clean'
rm "$tooling/extra.go"
check_tooling

git -C "$tooling" rm -q pluginsdk/go.mod
git -C "$tooling" commit -qm 'remove SDK directory'
git -C "$tooling" rev-parse HEAD > "$fixture/.kandev-tooling-ref"
expect_failure 'missing SDK directory' 'apps/backend/cmd/plugin-pack and root pluginsdk'

mkdir -p "$tooling/pluginsdk"
printf 'module fixture\n' > "$tooling/pluginsdk/go.mod"
git -C "$tooling" rm -q apps/backend/cmd/plugin-pack/main.go
git -C "$tooling" add pluginsdk/go.mod
git -C "$tooling" commit -qm 'remove packaging command directory'
git -C "$tooling" rev-parse HEAD > "$fixture/.kandev-tooling-ref"
expect_failure 'missing packaging command directory' 'apps/backend/cmd/plugin-pack and root pluginsdk'

printf '%040d\n' 0 > "$fixture/.kandev-tooling-ref"
expect_failure 'a different tooling revision' 'must match .kandev-tooling-ref'

printf 'tooling checkout positive and negative checks passed\n'
