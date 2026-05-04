#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -d /usr/local/opt/node@22/bin ]]; then
	export PATH="/usr/local/opt/node@22/bin:$PATH"
fi

COMMIT="${REMOTE_AI_RELEASE_CHECK_COMMIT:-dev-compat}"
MANIFEST_PATH="${REMOTE_AI_RELEASE_CHECK_MANIFEST:-$ROOT/remote-releases/$COMMIT/manifest.json}"
RUN_COMPILE="${REMOTE_AI_RELEASE_CHECK_COMPILE:-1}"
RUN_E2E="${REMOTE_AI_RELEASE_CHECK_E2E:-0}"

step() {
	printf '\n[remote-ai-release] %s\n' "$1"
}

step "release doctor"
node build/remote-ai/releaseDoctor.js "$MANIFEST_PATH"

if [[ ! -f "$ROOT/resources/aura-code/runtime-manifest.json" ]]; then
	echo "missing Aura runtime manifest: resources/aura-code/runtime-manifest.json" >&2
	exit 1
fi

if [[ "$RUN_COMPILE" == "1" ]]; then
	step "compile"
	npm run compile
else
	step "compile skipped"
fi

step "unit tests"
npx mocha --timeout 10000 --ui=tdd \
	build/remote-ai/test/*.test.js \
	extensions/our-remote-ssh/src/test/*.test.js \
	extensions/ai-codex-remote-bridge/src/test/*.test.js

if [[ "$RUN_E2E" == "1" ]]; then
	step "gui ssh e2e"
	node test/remote-ai/e2e/chatUiDisabledE2E.js
	node test/remote-ai/e2e/remoteAiFullE2E.js
else
	step "gui ssh e2e skipped; set REMOTE_AI_RELEASE_CHECK_E2E=1 to enable"
fi

step "diff whitespace"
git diff --check

step "passed"
