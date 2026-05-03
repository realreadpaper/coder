#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -d /usr/local/opt/node@22/bin ]]; then
	export PATH="/usr/local/opt/node@22/bin:$PATH"
fi

COMMIT="${REMOTE_AI_RELEASE_COMMIT:-$(git rev-parse --short=12 HEAD)}"
PLATFORM="${REMOTE_AI_RELEASE_PLATFORM:-linux-x64}"
OUT_ROOT="${REMOTE_AI_RELEASE_OUT:-$ROOT/.build/remote-ai-release}"
RELEASE_DIR="$OUT_ROOT/remote-releases/$COMMIT"
SERVER_SOURCE="${REMOTE_AI_SERVER_SOURCE:-$ROOT/../vscode-reh-$PLATFORM}"
SKIP_REH_BUILD="${REMOTE_AI_RELEASE_SKIP_REH_BUILD:-0}"
MIN_GLIBC="${REMOTE_AI_MIN_GLIBC:-}"
COMPAT_SERVER_SOURCE="${REMOTE_AI_COMPAT_SERVER_SOURCE:-}"

if [[ "$SKIP_REH_BUILD" != "1" ]]; then
	echo "[remote-ai-package] building vscode-reh-$PLATFORM..."
	npm run gulp "vscode-reh-$PLATFORM-min"
fi

if [[ ! -d "$SERVER_SOURCE" ]]; then
	echo "Remote server source is missing: $SERVER_SOURCE" >&2
	exit 1
fi

args=(
	--source "$SERVER_SOURCE"
	--commit "$COMMIT"
	--platform "$PLATFORM"
	--release-dir "$RELEASE_DIR"
	--include-extension extensions/ai-codex-remote-bridge
)

if [[ -n "$COMPAT_SERVER_SOURCE" ]]; then
	args+=(--compat-server-source "$COMPAT_SERVER_SOURCE")
fi

if [[ -n "$MIN_GLIBC" ]]; then
	args+=(--min-glibc "$MIN_GLIBC")
fi

echo "[remote-ai-package] packaging server into $RELEASE_DIR..."
node build/remote-ai/packageServer.js "${args[@]}"
node build/remote-ai/releaseDoctor.js "$RELEASE_DIR/manifest.json"

(
	cd "$RELEASE_DIR"
	shasum -a 256 ./* > SHA256SUMS
)

echo "[remote-ai-package] release dir: $RELEASE_DIR"
