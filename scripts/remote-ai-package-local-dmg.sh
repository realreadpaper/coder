#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ "$(uname -s)" != "Darwin" ]]; then
	echo "remote-ai-package-local-dmg.sh must run on macOS" >&2
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
VSCODE_PLATFORM_ARCH="darwin-$VSCODE_ARCH"
OUT_ROOT="${REMOTE_AI_RELEASE_OUT:-$ROOT/.build/remote-ai-release}"
APP_ROOT="${REMOTE_AI_DARWIN_APP_ROOT:-$ROOT/../VSCode-darwin-$VSCODE_ARCH}"
APP_NAME="$(node -p "require('./product.json').nameLong + '.app'")"
APP_PATH="$APP_ROOT/$APP_NAME"
CLIENT_DIR="$OUT_ROOT/client"
DMG_PATH="${REMOTE_AI_LOCAL_DMG_PATH:-$CLIENT_DIR/Aura-darwin-$VSCODE_ARCH-local-signed.dmg}"
DMG_STAGING_DIR="${REMOTE_AI_LOCAL_DMG_STAGING_DIR:-$CLIENT_DIR/dmg-staging}"
BUNDLED_RELEASES_SOURCE="$OUT_ROOT/remote-releases"
APP_RELEASES_DIR="$APP_PATH/Contents/Resources/remote-releases"
AURA_RUNTIME_SOURCE="$ROOT/resources/aura-code"
APP_AURA_RUNTIME_DIR="$APP_PATH/Contents/Resources/aura-code"
APP_EXTENSIONS_DIR="$APP_PATH/Contents/Resources/app/extensions"
APP_NODE_MODULES_DIR="$APP_PATH/Contents/Resources/app/node_modules"
CHECKSUM_PATH="$CLIENT_DIR/Aura-darwin-$VSCODE_ARCH-local-signed-SHA256SUMS.txt"

cleanup_dmg_staging() {
	rm -rf "$DMG_STAGING_DIR"
}

trap cleanup_dmg_staging EXIT

if [[ ! -d "$APP_PATH" ]]; then
	echo "macOS app is missing: $APP_PATH" >&2
	echo "Run scripts/remote-ai-package-darwin.sh once before using this fast local DMG packager." >&2
	exit 1
fi

if [[ ! -d "$BUNDLED_RELEASES_SOURCE" ]]; then
	echo "Bundled remote server releases are missing: $BUNDLED_RELEASES_SOURCE" >&2
	echo "Run scripts/remote-ai-package-release.sh before packaging the macOS app." >&2
	exit 1
fi

echo "[remote-ai-local-dmg] bundling remote server releases..."
rm -rf "$APP_RELEASES_DIR"
mkdir -p "$(dirname "$APP_RELEASES_DIR")"
ditto "$BUNDLED_RELEASES_SOURCE" "$APP_RELEASES_DIR"

if [[ -d "$AURA_RUNTIME_SOURCE" ]]; then
	echo "[remote-ai-local-dmg] bundling Aura Code runtimes..."
	rm -rf "$APP_AURA_RUNTIME_DIR"
	mkdir -p "$(dirname "$APP_AURA_RUNTIME_DIR")"
	ditto "$AURA_RUNTIME_SOURCE" "$APP_AURA_RUNTIME_DIR"
fi

echo "[remote-ai-local-dmg] refreshing Aura built-in extensions..."
npx tsc -p extensions/our-remote-ssh/tsconfig.json
rm -rf "$APP_EXTENSIONS_DIR/our-remote-ssh"
mkdir -p "$APP_EXTENSIONS_DIR"
ditto "$ROOT/extensions/our-remote-ssh" "$APP_EXTENSIONS_DIR/our-remote-ssh"

echo "[remote-ai-local-dmg] refreshing extension signature verifier..."
node "$ROOT/node_modules/@vscode/vsce-sign/src/postinstall.js"
for package_name in "@vscode/vsce-sign" "@vscode/vsce-sign-$VSCODE_PLATFORM_ARCH"; do
	if [[ ! -d "$ROOT/node_modules/$package_name" ]]; then
		echo "Missing runtime dependency: node_modules/$package_name" >&2
		echo "Run npm install before packaging the local DMG." >&2
		exit 1
	fi

	rm -rf "$APP_NODE_MODULES_DIR/$package_name"
	mkdir -p "$(dirname "$APP_NODE_MODULES_DIR/$package_name")"
	ditto "$ROOT/node_modules/$package_name" "$APP_NODE_MODULES_DIR/$package_name"
done

scripts/remote-ai-sign-darwin-local.sh "$APP_PATH"

mkdir -p "$CLIENT_DIR"
rm -f "$DMG_PATH"
rm -rf "$DMG_STAGING_DIR"
mkdir -p "$DMG_STAGING_DIR"
ditto "$APP_PATH" "$DMG_STAGING_DIR/$APP_NAME"
ln -s /Applications "$DMG_STAGING_DIR/Applications"

echo "[remote-ai-local-dmg] creating $DMG_PATH..."
hdiutil create \
	-volname "Aura" \
	-srcfolder "$DMG_STAGING_DIR" \
	-ov \
	-format UDZO \
	"$DMG_PATH"

shasum -a 256 "$DMG_PATH" > "$CHECKSUM_PATH"

echo "[remote-ai-local-dmg] artifact: $DMG_PATH"
echo "[remote-ai-local-dmg] sha256:   $CHECKSUM_PATH"
