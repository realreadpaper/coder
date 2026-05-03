/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface BootstrapResult {
	readonly os: string;
	readonly arch: string;
	readonly home: string;
	readonly serverDir: string;
	readonly serverPresent: boolean;
}

export function createBootstrapScript(commit: string): string {
	return `set -eu
echo "remoteai-bootstrap-start"
os="$(uname -s | tr '[:upper:]' '[:lower:]')"
arch="$(uname -m)"
case "$arch" in
	x86_64) arch="x64" ;;
	aarch64|arm64) arch="arm64" ;;
	*) echo "remoteai-error unsupported-arch=$arch"; exit 86 ;;
esac
home="\${HOME:?HOME is required}"
server_dir="$home/.remote-ai-server/bin/${commit}"
mkdir -p "$home/.remote-ai-server/bin" "$home/.remote-ai-server/logs"
echo "remoteai-os=$os"
echo "remoteai-arch=$arch"
echo "remoteai-home=$home"
echo "remoteai-server-dir=$server_dir"
if [ -x "$server_dir/bin/remote-ai-server" ]; then
	echo "remoteai-server-present=1"
else
	echo "remoteai-server-present=0"
fi
echo "remoteai-bootstrap-end"
`;
}

export function parseBootstrapOutput(output: string): BootstrapResult {
	const values = new Map<string, string>();
	for (const line of output.split(/\r?\n/)) {
		const match = line.match(/^remoteai-([^=]+)=(.*)$/);
		if (match) {
			values.set(match[1], match[2]);
		}
	}

	const os = getRequired(values, 'os');
	const arch = getRequired(values, 'arch');
	const home = getRequired(values, 'home');
	const serverDir = getRequired(values, 'server-dir');
	const serverPresent = getRequired(values, 'server-present') === '1';

	return { os, arch, home, serverDir, serverPresent };
}

function getRequired(values: Map<string, string>, key: string): string {
	const value = values.get(key);
	if (!value) {
		throw new Error(`Missing bootstrap value: ${key}`);
	}
	return value;
}
