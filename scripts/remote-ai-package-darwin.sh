#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ "$(uname -s)" != "Darwin" ]]; then
	echo "remote-ai-package-darwin.sh must run on macOS" >&2
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
OUT_ROOT="${REMOTE_AI_RELEASE_OUT:-$ROOT/.build/remote-ai-release}"
APP_ROOT="${REMOTE_AI_DARWIN_APP_ROOT:-$ROOT/../VSCode-darwin-$VSCODE_ARCH}"
SKIP_BUILD="${REMOTE_AI_DARWIN_SKIP_BUILD:-0}"
APP_NAME="$(node -p "require('./product.json').nameLong + '.app'")"
CLIENT_DIR="$OUT_ROOT/client"
ZIP_PATH="$CLIENT_DIR/remote-ai-darwin-$VSCODE_ARCH-unsigned.zip"

if [[ "$SKIP_BUILD" != "1" ]]; then
	echo "[remote-ai-darwin] downloading Electron for $VSCODE_ARCH..."
	npm run electron "$VSCODE_ARCH"
	echo "[remote-ai-darwin] building vscode-darwin-$VSCODE_ARCH-min..."
	npm run gulp "vscode-darwin-$VSCODE_ARCH-min"
fi

if [[ ! -d "$APP_ROOT/$APP_NAME" ]]; then
	echo "macOS app is missing: $APP_ROOT/$APP_NAME" >&2
	exit 1
fi

mkdir -p "$CLIENT_DIR"
rm -f "$ZIP_PATH"

echo "[remote-ai-darwin] archiving $APP_NAME..."
(
	cd "$APP_ROOT"
	ditto -c -k --sequesterRsrc --keepParent "$APP_NAME" "$ZIP_PATH"
)

(
	cd "$CLIENT_DIR"
	shasum -a 256 "$(basename "$ZIP_PATH")" > SHA256SUMS
)

echo "[remote-ai-darwin] artifact: $ZIP_PATH"
