#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST="${REMOTE_AI_CODEX_HOST:-${REMOTE_AI_VALIDATE_HOST:-dev}}"
VERSION="${REMOTE_AI_CODEX_VERSION:-}"
PLATFORM="${REMOTE_AI_CODEX_PLATFORM:-linux-x64}"
SYNC_CONFIG="${REMOTE_AI_SYNC_CODEX_CONFIG:-1}"

if [[ -d /usr/local/opt/node@22/bin ]]; then
	export PATH="/usr/local/opt/node@22/bin:$PATH"
fi

if [[ -z "$VERSION" ]]; then
	if command -v codex >/dev/null 2>&1; then
		VERSION="$(codex --version | awk '{print $2}' | sed 's/-alpha.*//')"
	else
		VERSION="0.128.0"
	fi
fi

case "$PLATFORM" in
	linux-x64)
		VENDOR_BINARY="package/vendor/x86_64-unknown-linux-musl/codex/codex"
		;;
	linux-arm64)
		VENDOR_BINARY="package/vendor/aarch64-unknown-linux-musl/codex/codex"
		;;
	*)
		echo "Unsupported Codex platform: $PLATFORM" >&2
		exit 2
		;;
esac

REMOTE_HOME="$(ssh "$HOST" 'printf %s "$HOME"')"
REMOTE_INSTALL_ROOT="${REMOTE_AI_REMOTE_CODEX_ROOT:-$REMOTE_HOME/.remote-ai-server/codex/$VERSION-$PLATFORM}"
REMOTE_BIN="$REMOTE_INSTALL_ROOT/bin/codex"
TMP_DIR="$(mktemp -d)"
cleanup() {
	rm -rf "$TMP_DIR"
}
trap cleanup EXIT

echo "[remote-ai-codex] packing @openai/codex@$VERSION-$PLATFORM"
npm pack "@openai/codex@$VERSION-$PLATFORM" --pack-destination "$TMP_DIR" >/dev/null
PACKAGE_TGZ="$(find "$TMP_DIR" -maxdepth 1 -name '*.tgz' -print -quit)"
REMOTE_TGZ="$REMOTE_INSTALL_ROOT/package.tgz"

ssh "$HOST" "mkdir -p '$(printf "%q" "$REMOTE_INSTALL_ROOT")' '$(printf "%q" "$REMOTE_INSTALL_ROOT/bin")'"
scp -q "$PACKAGE_TGZ" "$HOST:$REMOTE_TGZ"
ssh "$HOST" "cd '$(printf "%q" "$REMOTE_INSTALL_ROOT")' && rm -rf package && tar -xzf package.tgz && chmod +x '$(printf "%q" "$VENDOR_BINARY")' && rm -f bin/codex && ln -s '../$VENDOR_BINARY' bin/codex"

if [[ "$SYNC_CONFIG" == "1" ]]; then
	ssh "$HOST" "mkdir -p '$REMOTE_HOME/.codex'"
	if [[ -f "$HOME/.codex/config.toml" ]]; then
		scp -q "$HOME/.codex/config.toml" "$HOST:$REMOTE_HOME/.codex/config.toml"
	fi
	if [[ -f "$HOME/.codex/auth.json" ]]; then
		scp -q "$HOME/.codex/auth.json" "$HOST:$REMOTE_HOME/.codex/auth.json"
		ssh "$HOST" "chmod 600 '$REMOTE_HOME/.codex/auth.json'"
	fi
fi

ssh "$HOST" "'$REMOTE_BIN' --version"
echo "$REMOTE_BIN"
