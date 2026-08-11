#!/bin/sh
set -eu
cd "$(dirname "$0")"
node qa-tests.js
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
unzip -p Pokerspace.zip index.html > "$work/index.html"
unzip -p Pokerspace.zip README.md > "$work/README.md"
cmp "$work/index.html" index.html
cmp "$work/README.md" README.md
entries="$(unzip -Z1 Pokerspace.zip | LC_ALL=C sort)"
expected="$(printf 'README.md\nindex.html')"
[ "$entries" = "$expected" ] || { printf 'Unexpected package entries:\n%s\n' "$entries" >&2; exit 1; }
printf 'Release verified: Pokerspace.zip contains the tested index.html and README.md.\n'
