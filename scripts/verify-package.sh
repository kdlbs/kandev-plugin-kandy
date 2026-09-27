#!/bin/sh
set -eu

fail() {
	printf 'package verification failed: %s\n' "$1" >&2
	exit 1
}

if [ "$#" -lt 2 ] || [ "$#" -gt 3 ]; then
	fail 'usage: verify-package.sh PACKAGE_FILE_OR_DIR full | host PLATFORM'
fi

input=$1
mode=$2
host_platform=${3-}
package_dir=
temporary_dir=

if [ -d "$input" ]; then
	package_dir=$(CDPATH= cd -- "$input" && pwd)
elif [ -f "$input" ]; then
	temporary_dir=$(mktemp -d "${TMPDIR:-/tmp}/kandy-package-verify.XXXXXX")
	trap 'rm -rf "$temporary_dir"' EXIT HUP INT TERM
	unsafe_path=$(tar -tzf "$input" | awk '
		/^\// { print; exit }
		/(^|\/)\.\.(\/|$)/ { print; exit }
	')
	[ -z "$unsafe_path" ] || fail "archive contains an unsafe path: $unsafe_path"
	tar -xzf "$input" -C "$temporary_dir" || fail 'could not extract package archive'
	package_dir=$temporary_dir
else
	fail "package file or directory not found: $input"
fi

for required in manifest.yaml README.md ui/bundle.js checksums.txt; do
	[ -f "$package_dir/$required" ] || fail "missing required file: $required"
done

manifest_id=$(sed -nE 's/^id: "([^"]+)"$/\1/p' "$package_dir/manifest.yaml")
[ "$manifest_id" = "kandev-plugin-kandy" ] || fail "unexpected manifest id: ${manifest_id:-missing}"
manifest_version=$(sed -nE 's/^version: "([^"]+)"$/\1/p' "$package_dir/manifest.yaml")
make_version=$(sed -nE 's/^VERSION := ([^[:space:]]+)$/\1/p' "$(dirname "$0")/../Makefile")
[ -n "$manifest_version" ] || fail 'manifest.yaml has no version'
[ "$manifest_version" = "$make_version" ] || fail "manifest version $manifest_version differs from Makefile version $make_version"
printf '%s\n' "$manifest_version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$' || fail "manifest version is invalid: $manifest_version"

if [ -f "$input" ]; then
	expected_archive="kandev-plugin-kandy-$manifest_version.tar.gz"
	[ "$(basename "$input")" = "$expected_archive" ] || fail "package filename $(basename "$input") differs from $expected_archive"
fi

manifest_executables=$(awk '
	$0 == "runtime:" { in_runtime = 1; next }
	in_runtime && $0 == "  executables:" { in_executables = 1; next }
	in_executables && $0 !~ /^    / { exit }
	in_executables && /^    [[:alnum:]_-]+: "[^\"]+"$/ {
		platform = $1
		sub(/:$/, "", platform)
		path = $2
		gsub(/"/, "", path)
		print platform " " path
	}
' "$package_dir/manifest.yaml" | LC_ALL=C sort)
expected_executables=$(printf '%s\n' \
	'darwin-amd64 server/plugin-darwin-amd64' \
	'darwin-arm64 server/plugin-darwin-arm64' \
	'linux-amd64 server/plugin-linux-amd64' \
	'linux-arm64 server/plugin-linux-arm64' \
	'windows-amd64 server/plugin-windows-amd64.exe' | LC_ALL=C sort)
[ "$manifest_executables" = "$expected_executables" ] || fail 'manifest runtime.executables does not match the supported platform set'

case "$mode" in
	full)
		executable_paths=$(printf '%s\n' "$manifest_executables" | awk '{ print $2 }')
		;;
	host)
		[ -n "$host_platform" ] || fail 'host mode requires a platform name'
		executable_paths=$(printf '%s\n' "$manifest_executables" | awk -v platform="$host_platform" '$1 == platform { print $2 }')
		[ -n "$executable_paths" ] || fail "host platform is not declared: $host_platform"
		;;
	*)
		fail "unknown verification mode: $mode"
		;;
esac

for executable in $executable_paths; do
	[ -f "$package_dir/$executable" ] || fail "missing declared executable: $executable"
done

unexpected_entry=$(find "$package_dir" -mindepth 1 ! -type f ! -type d -print -quit)
[ -z "$unexpected_entry" ] || fail "package contains a non-file entry: ${unexpected_entry#"$package_dir"/}"
unexpected_dir=$(find "$package_dir" -mindepth 1 -type d -print | sed "s#^$package_dir/##" | awk '$0 != "server" && $0 != "ui" { print; exit }')
[ -z "$unexpected_dir" ] || fail "package contains an unexpected directory: $unexpected_dir"

expected_files=$(printf '%s\n' manifest.yaml README.md ui/bundle.js checksums.txt $executable_paths | LC_ALL=C sort)
actual_files=$(cd "$package_dir" && find . -type f -print | sed 's#^\./##' | LC_ALL=C sort)
[ "$actual_files" = "$expected_files" ] || {
	printf 'unexpected package file inventory\nexpected:\n%s\nfound:\n%s\n' "$expected_files" "$actual_files" >&2
	exit 1
}

checksum_entries=$(awk '
	NF != 2 { invalid = 1; next }
	{ path = $2; sub(/^\*/, "", path); print path }
	END { if (NR == 0 || invalid) exit 1 }
' "$package_dir/checksums.txt") || fail 'checksums.txt has invalid lines'
checksum_files=$(printf '%s\n' "$checksum_entries" | LC_ALL=C sort)
expected_checksum_files=$(printf '%s\n' manifest.yaml README.md ui/bundle.js $executable_paths | LC_ALL=C sort)
[ "$checksum_files" = "$expected_checksum_files" ] || fail 'checksums.txt does not list every package file exactly once'

if command -v sha256sum >/dev/null 2>&1; then
	(cd "$package_dir" && sha256sum -c checksums.txt) || fail 'checksum verification failed'
elif command -v shasum >/dev/null 2>&1; then
	(cd "$package_dir" && shasum -a 256 -c checksums.txt) || fail 'checksum verification failed'
else
	fail 'sha256sum or shasum is required'
fi
