#!/bin/sh
set -eu

repo_dir=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
verify_script=$repo_dir/scripts/verify-package.sh
test_dir=$(mktemp -d "${TMPDIR:-/tmp}/kandy-package-test.XXXXXX")
trap 'rm -rf "$test_dir"' EXIT HUP INT TERM
version=$(sed -nE 's/^VERSION := ([^[:space:]]+)$/\1/p' "$repo_dir/Makefile")

write_checksums() {
	fixture=$1
	(
		CDPATH= cd -- "$fixture"
		find . -type f ! -name checksums.txt -print > "$test_dir/checksum-paths.raw"
		LC_ALL=C sort "$test_dir/checksum-paths.raw" > "$test_dir/checksum-paths"
		: > checksums.txt
		while IFS= read -r path; do
			path=${path#./}
			if command -v sha256sum >/dev/null 2>&1; then
				sha256sum "$path"
			else
				shasum -a 256 "$path"
			fi
		done < "$test_dir/checksum-paths" >> checksums.txt
	)
}

create_fixture() {
	fixture=$1
	mkdir -p "$fixture/server" "$fixture/ui"
	cat > "$fixture/manifest.yaml" <<EOF
id: "kandev-plugin-kandy"
version: "$version"
runtime:
  type: binary
  executables:
    linux-amd64: "server/plugin-linux-amd64"
    linux-arm64: "server/plugin-linux-arm64"
    darwin-amd64: "server/plugin-darwin-amd64"
    darwin-arm64: "server/plugin-darwin-arm64"
    windows-amd64: "server/plugin-windows-amd64.exe"
EOF
	printf '# Kandy fixture\n' > "$fixture/README.md"
	printf 'window.bundleFixture = true;\n' > "$fixture/ui/bundle.js"
	for executable in \
		plugin-linux-amd64 plugin-linux-arm64 \
		plugin-darwin-amd64 plugin-darwin-arm64 \
		plugin-windows-amd64.exe; do
		printf 'fixture binary: %s\n' "$executable" > "$fixture/server/$executable"
	done
	write_checksums "$fixture"
}

copy_fixture() {
	name=$1
	mkdir -p "$test_dir/$name"
	cp -R "$test_dir/valid/." "$test_dir/$name/"
}

expect_failure() {
	name=$1
	fixture=$2
	mode=${3-full}
	platform=${4-}
	if [ "$mode" = host ]; then
		if sh "$verify_script" "$fixture" host "$platform" >/dev/null 2>&1; then
			printf 'expected package verification to reject %s\n' "$name" >&2
			exit 1
		fi
	elif sh "$verify_script" "$fixture" full >/dev/null 2>&1; then
		printf 'expected package verification to reject %s\n' "$name" >&2
		exit 1
	fi
}

create_fixture "$test_dir/valid"
sh "$verify_script" "$test_dir/valid" full >/dev/null

host_platform=$(go env GOOS)-$(go env GOARCH)
copy_fixture host-valid
host_fixture=$test_dir/host-valid
host_executable=$(awk -v platform="$host_platform" '$0 ~ "    " platform ":" { gsub(/"/, "", $2); print $2 }' "$host_fixture/manifest.yaml")
[ -n "$host_executable" ] || { printf 'fixture does not declare host platform %s\n' "$host_platform" >&2; exit 1; }
for executable in "$host_fixture"/server/*; do
	[ "$executable" = "$host_fixture/$host_executable" ] || rm "$executable"
done
write_checksums "$host_fixture"
sh "$verify_script" "$host_fixture" host "$host_platform" >/dev/null
if sh "$verify_script" "$host_fixture" full >/dev/null 2>&1; then
	printf 'expected the host-only fixture to fail full-package verification\n' >&2
	exit 1
fi

copy_fixture missing-host-binary
rm "$test_dir/missing-host-binary/$host_executable"
write_checksums "$test_dir/missing-host-binary"
expect_failure 'a missing host platform binary' "$test_dir/missing-host-binary" host "$host_platform"
expect_failure 'an undeclared host platform' "$test_dir/valid" host unsupported-host

copy_fixture missing-ui
rm "$test_dir/missing-ui/ui/bundle.js"
write_checksums "$test_dir/missing-ui"
expect_failure 'a missing UI bundle' "$test_dir/missing-ui"

copy_fixture missing-binary
rm "$test_dir/missing-binary/server/plugin-linux-amd64"
write_checksums "$test_dir/missing-binary"
expect_failure 'a missing declared platform binary' "$test_dir/missing-binary"

copy_fixture unexpected-file
printf 'unexpected\n' > "$test_dir/unexpected-file/extra.txt"
write_checksums "$test_dir/unexpected-file"
expect_failure 'an unexpected package file' "$test_dir/unexpected-file"

copy_fixture incomplete-checksums
sed '/ui\/bundle.js$/d' "$test_dir/incomplete-checksums/checksums.txt" > "$test_dir/incomplete-checksums/checksums.next"
mv "$test_dir/incomplete-checksums/checksums.next" "$test_dir/incomplete-checksums/checksums.txt"
expect_failure 'an omitted checksum entry' "$test_dir/incomplete-checksums"

copy_fixture corrupt-bundle
printf '// changed after checksum generation\n' >> "$test_dir/corrupt-bundle/ui/bundle.js"
expect_failure 'a corrupted UI bundle' "$test_dir/corrupt-bundle"

copy_fixture wrong-platforms
sed '/windows-amd64:/d' "$test_dir/wrong-platforms/manifest.yaml" > "$test_dir/wrong-platforms/manifest.next"
mv "$test_dir/wrong-platforms/manifest.next" "$test_dir/wrong-platforms/manifest.yaml"
write_checksums "$test_dir/wrong-platforms"
expect_failure 'an unsupported runtime platform set' "$test_dir/wrong-platforms"

archive="$test_dir/kandev-plugin-kandy-$version.tar.gz"
tar -czf "$archive" -C "$test_dir/valid" .
sh "$verify_script" "$archive" full >/dev/null
if sh "$verify_script" "$test_dir/valid" unknown >/dev/null 2>&1; then
	printf 'expected an unknown verification mode to fail\n' >&2
	exit 1
fi

printf 'package verifier positive and negative checks passed\n'
