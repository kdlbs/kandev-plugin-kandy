#!/bin/sh
set -eu

fail() {
	printf 'release version verification failed: %s\n' "$1" >&2
	exit 1
}

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
	fail 'usage: verify-release-version.sh TAG [PACKAGE_FILE]'
fi

tag=$1
version_pattern='^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$'
printf '%s\n' "$tag" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$' || fail "tag is not a release version: $tag"
tag_version=${tag#v}
manifest_version=$(sed -nE 's/^version: "([^"]+)"$/\1/p' manifest.yaml)
make_version=$(sed -nE 's/^VERSION := ([^[:space:]]+)$/\1/p' Makefile)
[ -n "$manifest_version" ] || fail 'manifest.yaml has no version'
[ -n "$make_version" ] || fail 'Makefile has no VERSION'
printf '%s\n' "$manifest_version" | grep -Eq "$version_pattern" || fail "manifest version is invalid: $manifest_version"
printf '%s\n' "$make_version" | grep -Eq "$version_pattern" || fail "Makefile version is invalid: $make_version"
[ "$manifest_version" = "$make_version" ] || fail "manifest version $manifest_version differs from Makefile version $make_version"
[ "$tag_version" = "$manifest_version" ] || fail "tag $tag differs from manifest version $manifest_version"

if [ "$#" -eq 2 ]; then
	package_file=$2
	expected_package=$(make -s package-file)
	[ -f "$package_file" ] || fail "package file not found: $package_file"
	[ "$(basename "$package_file")" = "$expected_package" ] || fail "package filename $(basename "$package_file") differs from $expected_package"
	package_version=$(tar -xOzf "$package_file" manifest.yaml | sed -nE 's/^version: "([^"]+)"$/\1/p') || fail 'could not read package manifest'
	[ "$package_version" = "$tag_version" ] || fail "package manifest version ${package_version:-missing} differs from tag $tag"
fi
