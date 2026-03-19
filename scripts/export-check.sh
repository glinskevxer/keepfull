#!/usr/bin/env bash
# Builds what git would actually ship, in a clean directory, and runs it.
#
# This exists because a file that is on the machine but not in the index will
# compile happily forever and then vanish the moment somebody clones. That has
# happened here once, with a migration.
set -euo pipefail

cd "$(dirname "$0")/.."

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

echo "== exporting the index into $work"
git archive --format=tar HEAD | tar -x -C "$work"

cd "$work"

echo "== the export has to carry every migration"
expected=$(grep -c "^import { migration as" src/db/migrations/index.ts)
actual=$(find src/db/migrations -name '0*.ts' | wc -l | tr -d ' ')
if [ "$expected" != "$actual" ]; then
  echo "the index imports $expected migrations but the export carries $actual" >&2
  exit 1
fi

echo "== installing"
npm ci --no-audit --no-fund >/dev/null

echo "== building"
npm run build

echo "== the cli has to actually start"
node dist/cli/main.js --help >/dev/null

echo "== the built package has to expose its entry points"
test -f dist/index.js
test -f dist/api/main.js
test -f dist/cli/main.js

echo "all clear"
