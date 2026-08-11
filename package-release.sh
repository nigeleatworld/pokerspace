#!/bin/sh
set -eu
cd "$(dirname "$0")"
rm -f Pokerspace.zip
zip -X -q Pokerspace.zip index.html README.md
./release-check.sh
