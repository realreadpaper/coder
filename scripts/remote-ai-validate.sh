#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -d /usr/local/opt/node@22/bin ]]; then
	export PATH="/usr/local/opt/node@22/bin:$PATH"
fi

HOST="${REMOTE_AI_VALIDATE_HOST:-dev}"
REMOTE_PATH="${REMOTE_AI_VALIDATE_REMOTE_PATH:-/home/hejianglong/remote-ai-manual}"
COMMIT="${REMOTE_AI_VALIDATE_COMMIT:-dev-compat}"
USER_DATA_DIR="${REMOTE_AI_VALIDATE_USER_DATA_DIR:-/tmp/remote-ai-validate-user-data}"
LOGS_DIR="${REMOTE_AI_VALIDATE_LOGS_DIR:-/tmp/remote-ai-validate-logs}"
CODEX_EXTENSIONS_DIR="${REMOTE_AI_VALIDATE_EXTENSIONS_DIR:-$HOME/.vscode/extensions}"
LOCAL_CODEX_CLI="${REMOTE_AI_VALIDATE_CODEX_CLI:-$(command -v codex || true)}"
REMOTE_CODEX_CLI="${REMOTE_AI_VALIDATE_REMOTE_CODEX_CLI:-}"
RELEASE_DIR="$ROOT/remote-releases/$COMMIT"
MANIFEST_PATH="$RELEASE_DIR/manifest.json"
TARBALL_PATH="$RELEASE_DIR/vscode-reh-linux-x64.tar.gz"
SERVER_SOURCE="${REMOTE_AI_VALIDATE_SERVER_SOURCE:-$ROOT/../vscode-reh-linux-x64}"
COMPAT_SERVER_SOURCE="${REMOTE_AI_VALIDATE_COMPAT_SERVER_SOURCE:-$ROOT/../remote-server/extracted/vscode-reh-linux-x64}"
ELECTRON_APP="$ROOT/.build/electron/Code - OSS.app/Contents/MacOS/Electron"

usage() {
	cat <<EOF
Usage: scripts/remote-ai-validate.sh [--prepare-only] [--no-prepare-remote]

Environment overrides:
REMOTE_AI_VALIDATE_HOST              SSH host, default: dev
REMOTE_AI_VALIDATE_REMOTE_PATH       Remote workspace, default: /home/hejianglong/remote-ai-manual
REMOTE_AI_VALIDATE_USER_DATA_DIR     Local user data dir, default: /tmp/remote-ai-validate-user-data
REMOTE_AI_VALIDATE_LOGS_DIR          Local logs dir, default: /tmp/remote-ai-validate-logs
REMOTE_AI_VALIDATE_COMMIT            RemoteAI server commit id, default: dev-compat
REMOTE_AI_VALIDATE_EXTENSIONS_DIR    Local extensions dir, default: ~/.vscode/extensions
REMOTE_AI_VALIDATE_CODEX_CLI         Local Codex CLI for the OpenAI UI extension, default: PATH codex
REMOTE_AI_VALIDATE_REMOTE_CODEX_CLI  Remote Linux Codex CLI path. Empty prepares one on the SSH host
EOF
}

PREPARE_ONLY=0
PREPARE_REMOTE=1
while [[ $# -gt 0 ]]; do
	case "$1" in
		--prepare-only)
			PREPARE_ONLY=1
			shift
			;;
		--no-prepare-remote)
			PREPARE_REMOTE=0
			shift
			;;
		-h|--help)
			usage
			exit 0
			;;
		*)
			echo "Unknown argument: $1" >&2
			usage >&2
			exit 2
			;;
	esac
done

if [[ ! -x "$ELECTRON_APP" ]]; then
	echo "[remote-ai] Electron is missing, downloading it with npm run electron..."
	npm run electron
fi

if [[ ! -f "$MANIFEST_PATH" || ! -f "$TARBALL_PATH" ]]; then
	echo "[remote-ai] Remote server package is missing, creating $TARBALL_PATH..."
	node build/remote-ai/packageServer.js \
		--source "$SERVER_SOURCE" \
		--commit "$COMMIT" \
		--release-dir "$RELEASE_DIR" \
		--compat-server-source "$COMPAT_SERVER_SOURCE" \
		--min-glibc 2.17 \
		--include-extension extensions/ai-codex-remote-bridge
fi
node build/remote-ai/releaseDoctor.js "$MANIFEST_PATH" >/dev/null

EXTENSION_ARGS=()
if [[ -d "$CODEX_EXTENSIONS_DIR" ]]; then
	node build/remote-ai/codexExtensionPatch.js "$CODEX_EXTENSIONS_DIR" >/dev/null
	EXTENSION_ARGS+=(--extensions-dir="$CODEX_EXTENSIONS_DIR")
fi

if [[ -z "$REMOTE_CODEX_CLI" ]]; then
	REMOTE_CODEX_CLI="$(REMOTE_AI_CODEX_HOST="$HOST" scripts/remote-ai-prepare-codex.sh | tail -n 1)"
fi

mkdir -p "$USER_DATA_DIR/User" "$LOGS_DIR"
node - "$ROOT" "$USER_DATA_DIR" "$MANIFEST_PATH" "$TARBALL_PATH" "$COMMIT" "$REMOTE_PATH" "$LOCAL_CODEX_CLI" "$REMOTE_CODEX_CLI" <<'NODE'
const fs = require('fs');
const path = require('path');

const [, , root, userDataDir, manifestPath, tarballPath, commit, remotePath, localCodexCli, remoteCodexCli] = process.argv;
const settingsPath = path.join(userDataDir, 'User', 'settings.json');
const settings = {
	'remoteai.ssh.serverManifestPath': manifestPath,
	'remoteai.ssh.serverTarballPath': tarballPath,
	'remoteai.ssh.commit': commit,
	'remoteai.ssh.defaultRemotePath': remotePath,
	'remoteai.ssh.sshPath': 'ssh',
	'remote.extensionKind': {
		'openai.chatgpt': ['ui'],
		'our.ai-codex-remote-bridge': ['workspace', 'ui']
	},
	'remoteai.codex.remoteCliPath': remoteCodexCli,
	'remoteai.codex.sandboxMode': 'danger-full-access',
	'chatgpt.useExperimentalLspMcpServer': true,
	'terminal.integrated.defaultProfile.linux': 'bash',
	'terminal.integrated.profiles.linux': {
		bash: {
			path: '/bin/bash'
		}
	}
};
if (localCodexCli) {
	settings['chatgpt.cliExecutable'] = localCodexCli;
}
fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
NODE

if [[ "$PREPARE_REMOTE" == "1" ]]; then
	ssh "$HOST" "if [ ! -d '$REMOTE_PATH/.git' ]; then rm -rf '$REMOTE_PATH' && mkdir -p '$REMOTE_PATH' && cd '$REMOTE_PATH' && git init -q && printf 'hello remote-ai manual\n' > README.md && printf 'export const value = 1;\nexport function smokeSymbol() { return value; }\n' > index.ts && git add README.md index.ts && git -c user.name='RemoteAI Manual' -c user.email='remoteai@example.invalid' commit -qm 'initial manual fixture'; fi"
fi

echo "[remote-ai] user-data: $USER_DATA_DIR"
echo "[remote-ai] logs:      $LOGS_DIR"
echo "[remote-ai] host:      $HOST"
echo "[remote-ai] path:      $REMOTE_PATH"
echo "[remote-ai] codex UI:  ${LOCAL_CODEX_CLI:-codex}"
echo "[remote-ai] codex SSH: $REMOTE_CODEX_CLI"

if [[ "$PREPARE_ONLY" == "1" ]]; then
	echo "[remote-ai] prepare-only complete."
	exit 0
fi

echo "[remote-ai] launching Code-OSS dev window..."
export VSCODE_SKIP_PRELAUNCH="${VSCODE_SKIP_PRELAUNCH:-1}"
exec "$ROOT/scripts/code.sh" \
	--skip-welcome \
	--skip-release-notes \
	--disable-workspace-trust \
	--disable-telemetry \
	--disable-updates \
	--user-data-dir="$USER_DATA_DIR" \
	--logsPath="$LOGS_DIR" \
	"${EXTENSION_ARGS[@]}"
