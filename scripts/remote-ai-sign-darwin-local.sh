#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ "$(uname -s)" != "Darwin" ]]; then
	echo "remote-ai-sign-darwin-local.sh must run on macOS" >&2
	exit 1
fi

if [[ -d /usr/local/opt/node@22/bin ]]; then
	export PATH="/usr/local/opt/node@22/bin:$PATH"
fi

HOST_ARCH="$(uname -m)"
if [[ "$HOST_ARCH" == "arm64" ]]; then
	DEFAULT_ARCH="arm64"
else
	DEFAULT_ARCH="x64"
fi

VSCODE_ARCH="${VSCODE_ARCH:-$DEFAULT_ARCH}"
APP_ROOT="${REMOTE_AI_DARWIN_APP_ROOT:-$ROOT/../VSCode-darwin-$VSCODE_ARCH}"
APP_NAME="$(node -p "require('./product.json').nameLong + '.app'")"
APP_PATH="${1:-$APP_ROOT/$APP_NAME}"

if [[ ! -d "$APP_PATH" ]]; then
	echo "macOS app is missing: $APP_PATH" >&2
	echo "Run scripts/remote-ai-package-darwin.sh once, then use scripts/remote-ai-package-local-dmg.sh for fast local repackaging." >&2
	exit 1
fi

echo "[remote-ai-sign-local] clearing quarantine/provenance attributes..."
xattr -dr com.apple.quarantine "$APP_PATH" 2>/dev/null || true
xattr -dr com.apple.provenance "$APP_PATH" 2>/dev/null || true

echo "[remote-ai-sign-local] ad-hoc signing $APP_PATH..."
codesign --force --deep --sign - "$APP_PATH"

echo "[remote-ai-sign-local] verifying signature..."
codesign --verify --deep --strict --verbose=4 "$APP_PATH"

echo "[remote-ai-sign-local] signed: $APP_PATH"
