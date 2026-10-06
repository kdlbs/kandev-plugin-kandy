#!/bin/sh
set -eu

if [ "$#" != 1 ] || [ ! -f "$1" ]; then
	printf 'usage: audit-package.sh PACKAGE_FILE\n' >&2
	exit 2
fi

# Audit the compiled toolchain and linked dependencies, not the Go version
# selected to run the scanner. Run only on a package verified by verify-package.
scan_dir=$(mktemp -d "${TMPDIR:-/tmp}/kandy-package-audit.XXXXXX")
trap 'rm -rf "$scan_dir"' EXIT HUP INT TERM
tar -xzf "$1" -C "$scan_dir" server

for binary in "$scan_dir"/server/plugin-*; do
	[ -f "$binary" ] || { printf 'package contains no server binary\n' >&2; exit 1; }
	printf 'Auditing %s\n' "$(basename "$binary")"
	go run golang.org/x/vuln/cmd/govulncheck@v1.8.0 -mode=binary "$binary"
done
