#!/usr/bin/env bash
# Runs the full E2E suite (including visual regression) inside the official Playwright image,
# the same environment CI uses, so screenshot baselines match across machines.
#
#   pnpm test:e2e:visual            # compare against committed baselines
#   pnpm test:e2e:visual --update   # regenerate baselines (review the diff before committing)
#   bash tools/e2e-docker.sh [--update] tests/sandbox.spec.ts --grep S34   # a subset
set -euo pipefail

IMAGE="mcr.microsoft.com/playwright:v1.65.1-noble"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PNPM_VERSION="$(node -p "require('$ROOT/package.json').packageManager.split('@')[1]")"
UPDATE=""
if [[ "${1:-}" == "--update" ]]; then UPDATE="--update-snapshots"; shift; fi
# Anything else goes to `playwright test` (spec files, --grep, --repeat-each ...).
EXTRA=""
for a in "$@"; do EXTRA+=" $(printf '%q' "$a")"; done

# The repository is mounted read-only and copied without node_modules: native bindings
# installed on the host (macOS) cannot run in the Linux container.
docker run --rm --ipc=host --init \
  -v "$ROOT":/src:ro \
  -v "$ROOT/e2e":/out \
  -e CI=1 -e PW_VISUAL=1 \
  "$IMAGE" bash -euo pipefail -c "
    mkdir -p /work && cd /work
    tar -C /src --exclude=node_modules --exclude=.git --exclude=.data --exclude=.claude \
      --exclude='*/dist' --exclude=e2e/test-results --exclude=e2e/playwright-report -cf - . | tar -xf -
    npm install -g --silent pnpm@$PNPM_VERSION
    pnpm install --frozen-lockfile --reporter=silent
    pnpm build > /dev/null
    status=0
    (cd e2e && pnpm exec playwright test $UPDATE $EXTRA) || status=\$?
    rm -rf /out/test-results /out/playwright-report
    cp -r e2e/test-results e2e/playwright-report /out/ 2>/dev/null || true
    if [[ -n '$UPDATE' ]]; then rm -rf /out/tests/__screenshots__ && cp -r e2e/tests/__screenshots__ /out/tests/; fi
    exit \$status
  "
