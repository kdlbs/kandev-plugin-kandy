#!/bin/sh
set -eu

repo_dir=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
verify_script=$repo_dir/scripts/verify-release-version.sh
test_dir=$(mktemp -d "${TMPDIR:-/tmp}/kandy-release-version-test.XXXXXX")
trap 'rm -rf "$test_dir"' EXIT HUP INT TERM
base_version=$(sed -nE 's/^version: "([^"]+)"$/\1/p' "$repo_dir/manifest.yaml")
wrong_version=999.999.999
[ "$wrong_version" != "$base_version" ] || wrong_version=999.999.998

make_fixture() {
	name=$1
	fixture=$test_dir/$name
	mkdir -p "$fixture"
	cp "$repo_dir/Makefile" "$repo_dir/manifest.yaml" "$fixture/"
}

expect_failure() {
	name=$1
	fixture=$2
	expected_error=$3
	shift 3
	if (cd "$fixture" && sh "$verify_script" "$@") > "$test_dir/output" 2>&1; then
		printf 'expected release verification to reject %s\n' "$name" >&2
		exit 1
	fi
	if ! grep -F "$expected_error" "$test_dir/output" >/dev/null; then
		printf 'release verification rejected %s for the wrong reason; expected: %s\n' "$name" "$expected_error" >&2
		cat "$test_dir/output" >&2
		exit 1
	fi
}

make_fixture valid
(cd "$test_dir/valid" && sh "$verify_script" "v$base_version")

make_fixture prerelease
prerelease_version=0.15.0-rc.2
sed "s/^version: \"$base_version\"$/version: \"$prerelease_version\"/" "$test_dir/prerelease/manifest.yaml" > "$test_dir/prerelease/manifest.next"
mv "$test_dir/prerelease/manifest.next" "$test_dir/prerelease/manifest.yaml"
sed "s/^VERSION := $base_version$/VERSION := $prerelease_version/" "$test_dir/prerelease/Makefile" > "$test_dir/prerelease/Makefile.next"
mv "$test_dir/prerelease/Makefile.next" "$test_dir/prerelease/Makefile"
(cd "$test_dir/prerelease" && sh "$verify_script" "v$prerelease_version")

make_fixture wrong-tag
expect_failure 'a tag that differs from manifest.yaml' "$test_dir/wrong-tag" \
	"tag v$wrong_version differs from manifest version" "v$wrong_version"

make_fixture wrong-manifest
sed "s/^version: \"$base_version\"$/version: \"$wrong_version\"/" "$test_dir/wrong-manifest/manifest.yaml" > "$test_dir/wrong-manifest/manifest.next"
mv "$test_dir/wrong-manifest/manifest.next" "$test_dir/wrong-manifest/manifest.yaml"
expect_failure 'a manifest version that differs from Makefile' "$test_dir/wrong-manifest" \
	"manifest version $wrong_version differs from Makefile version" "v$base_version"

make_fixture wrong-makefile
sed "s/^VERSION := $base_version$/VERSION := $wrong_version/" "$test_dir/wrong-makefile/Makefile" > "$test_dir/wrong-makefile/Makefile.next"
mv "$test_dir/wrong-makefile/Makefile.next" "$test_dir/wrong-makefile/Makefile"
expect_failure 'a Makefile version that differs from manifest.yaml' "$test_dir/wrong-makefile" \
	"manifest version $base_version differs from Makefile version $wrong_version" "v$base_version"

make_fixture wrong-package
mkdir -p "$test_dir/wrong-package/archive"
sed "s/^version: \"$base_version\"$/version: \"$wrong_version\"/" "$test_dir/wrong-package/manifest.yaml" > "$test_dir/wrong-package/archive/manifest.yaml"
package_file="kandev-plugin-kandy-$base_version.tar.gz"
tar -czf "$test_dir/wrong-package/$package_file" -C "$test_dir/wrong-package/archive" manifest.yaml
expect_failure 'an archive manifest that differs from the tag' "$test_dir/wrong-package" \
	"package manifest version $wrong_version differs from tag v$base_version" "v$base_version" "$package_file"

make_fixture matching-package
mkdir -p "$test_dir/matching-package/archive"
cp "$test_dir/matching-package/manifest.yaml" "$test_dir/matching-package/archive/manifest.yaml"
package_file="kandev-plugin-kandy-$base_version.tar.gz"
tar -czf "$test_dir/matching-package/$package_file" -C "$test_dir/matching-package/archive" manifest.yaml
(cd "$test_dir/matching-package" && sh "$verify_script" "v$base_version" "$package_file")

expect_failure 'a non-version release tag' "$test_dir/valid" \
	'tag is not a release version' "release-$base_version"
printf 'release version positive and negative checks passed\n'
