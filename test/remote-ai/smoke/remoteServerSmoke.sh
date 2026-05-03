#!/usr/bin/env sh
set -eu

SERVER_DIR="${1:-}"
if [ -z "$SERVER_DIR" ]; then
	echo "usage: remoteServerSmoke.sh <extracted-vscode-reh-linux-x64-dir>" >&2
	exit 2
fi

required() {
	if [ ! -e "$SERVER_DIR/$1" ]; then
		echo "missing required server file: $1" >&2
		exit 1
	fi
}

required "bin/remote-ai-server"
required "node"
required "out/server-main.js"
required "product.json"

if [ ! -x "$SERVER_DIR/bin/remote-ai-server" ]; then
	echo "server wrapper is not executable: bin/remote-ai-server" >&2
	exit 1
fi

if [ "$(uname -s)" = "Linux" ]; then
	"$SERVER_DIR/node" -e "process.stdout.write(process.versions.node)"
	echo
fi

echo "remote server smoke passed"
