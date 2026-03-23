#!/usr/bin/env bash
# Everything ci runs, in the order ci runs it, so a red build never comes as a
# surprise. Stops at the first failure on purpose.
set -euo pipefail

cd "$(dirname "$0")/.."

step() {
  printf '\n== %s\n' "$1"
}

step 'lint'
npm run lint

step 'types'
npm run typecheck

step 'formatting'
npx prettier --check "src/**/*.ts" "tests/**/*.ts"

step 'the command reference matches the cli'
npm run commands:check

step 'tests'
npm test

step 'coverage'
npm run coverage

printf '\nall clear\n'
