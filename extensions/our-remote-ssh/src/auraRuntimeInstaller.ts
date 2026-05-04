/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface AuraRuntimeRegistry {
	readonly runtimes: Record<string, {
		readonly version: string;
		readonly platformKey?: string;
		readonly binPath: string;
		readonly source?: string;
		readonly sha256?: string;
		readonly installedAt?: string;
	}>;
}

export interface AuraRuntimeRemoteProbe {
	readonly home: string;
	readonly os: string;
	readonly arch: string;
	readonly platformKey: string;
	readonly registry: AuraRuntimeRegistry;
}

export interface AuraRuntimeInstallScriptOptions {
	readonly providerId: string;
	readonly version: string;
	readonly platformKey: string;
	readonly uploadPath: string;
	readonly installDir: string;
	readonly binRelativePath: string;
	readonly sha256: string;
	readonly sourceKind: string;
}

export interface AuraRuntimeUploadPlan {
	readonly remotePath: string;
	readonly remoteCommand: string;
}

export interface AuraRuntimeRemoteDownloadScriptOptions {
	readonly url: string;
	readonly remotePath: string;
}

export function buildAuraRuntimeProbeScript(): string {
	return `set -eu
home="$HOME"
os="$(uname -s | tr '[:upper:]' '[:lower:]')"
arch="$(uname -m)"
case "$arch" in
	x86_64) arch="x64" ;;
	aarch64|arm64) arch="arm64" ;;
esac
registry_path="$home/.aura-code/runtimes/registry.json"
echo "aura-runtime-home=$home"
echo "aura-runtime-os=$os"
echo "aura-runtime-arch=$arch"
if [ -f "$registry_path" ]; then
	printf 'aura-runtime-registry='
	cat "$registry_path"
	printf '\\n'
else
	echo 'aura-runtime-registry={"runtimes":{}}'
fi
`;
}

export function parseAuraRuntimeProbeOutput(output: string): AuraRuntimeRemoteProbe {
	const values = new Map<string, string>();
	for (const line of output.split(/\r?\n/)) {
		const index = line.indexOf('=');
		if (index > 0) {
			values.set(line.slice(0, index), line.slice(index + 1));
		}
	}
	const home = required(values, 'aura-runtime-home');
	const os = required(values, 'aura-runtime-os');
	const arch = required(values, 'aura-runtime-arch');
	const registry = JSON.parse(required(values, 'aura-runtime-registry')) as AuraRuntimeRegistry;
	return { home, os, arch, platformKey: `${os}-${arch}`, registry };
}

export function buildAuraRuntimeInstallScript(options: AuraRuntimeInstallScriptOptions): string {
	const marker = JSON.stringify({
		version: options.version,
		platformKey: options.platformKey,
		binPath: `${options.installDir}/${options.binRelativePath}`,
		source: options.sourceKind,
		sha256: options.sha256
	});
	return `set -eu
upload_path=${shellQuote(options.uploadPath)}
install_dir=${shellQuote(options.installDir)}
tmp_dir="$install_dir.tmp"
registry_path="$HOME/.aura-code/runtimes/registry.json"
provider_id=${shellQuote(options.providerId)}
expected_sha=${shellQuote(options.sha256)}
bin_relative=${shellQuote(options.binRelativePath)}
rm -rf "$tmp_dir"
mkdir -p "$tmp_dir" "$(dirname "$registry_path")"
if command -v sha256sum >/dev/null 2>&1; then
	actual_sha="$(sha256sum "$upload_path" | awk '{print $1}')"
elif command -v shasum >/dev/null 2>&1; then
	actual_sha="$(shasum -a 256 "$upload_path" | awk '{print $1}')"
else
	echo "aura-runtime-error missing-sha256-tool"
	exit 89
fi
if [ "$expected_sha" != "0000000000000000000000000000000000000000000000000000000000000000" ] && [ "$actual_sha" != "$expected_sha" ]; then
	echo "aura-runtime-error sha256-mismatch=$actual_sha"
	exit 87
fi
tar -xzf "$upload_path" -C "$tmp_dir"
if [ ! -x "$tmp_dir/$bin_relative" ]; then
	chmod +x "$tmp_dir/$bin_relative" 2>/dev/null || true
	if [ ! -x "$tmp_dir/$bin_relative" ]; then
		echo "aura-runtime-error missing-binary=$tmp_dir/$bin_relative"
		exit 88
	fi
fi
"$tmp_dir/$bin_relative" --version >/dev/null
rm -rf "$install_dir"
mv "$tmp_dir" "$install_dir"
ln -sfn "$(basename "$install_dir")" "$(dirname "$install_dir")/current"
node - "$registry_path" "$provider_id" <<'AURA_RUNTIME_NODE'
const fs = require('fs');
const registryPath = process.argv[2];
const providerId = process.argv[3];
const marker = ${JSON.stringify(marker)};
let registry = { runtimes: {} };
if (fs.existsSync(registryPath)) {
	registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
}
registry.runtimes[providerId] = { ...JSON.parse(marker), installedAt: new Date().toISOString() };
fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));
AURA_RUNTIME_NODE
rm -f "$upload_path"
echo "aura-runtime-install=ok"
`;
}

export function buildAuraRuntimeRemoteDownloadScript(options: AuraRuntimeRemoteDownloadScriptOptions): string {
	return `set -eu
url=${shellQuote(options.url)}
remote_path=${shellQuote(options.remotePath)}
mkdir -p "$(dirname "$remote_path")"
if command -v curl >/dev/null 2>&1; then
	curl -fL --retry 2 --connect-timeout 15 -o "$remote_path" "$url"
elif command -v wget >/dev/null 2>&1; then
	wget -O "$remote_path" "$url"
else
	echo "aura-runtime-error missing-download-tool"
	exit 86
fi
echo "aura-runtime-download=ok"
`;
}

export function createAuraRuntimeUploadPlan(options: {
	readonly home: string;
	readonly providerId: string;
	readonly version: string;
	readonly platformKey: string;
}): AuraRuntimeUploadPlan {
	const remotePath = `${options.home}/.aura-code/upload/${options.providerId}-${options.version}-${options.platformKey}.tar.gz`;
	return {
		remotePath,
		remoteCommand: `mkdir -p ${shellQuote(`${options.home}/.aura-code/upload`)} && cat > ${shellQuote(remotePath)}`
	};
}

function required(values: Map<string, string>, key: string): string {
	const value = values.get(key);
	if (!value) {
		throw new Error(`Missing ${key} in Aura runtime probe output`);
	}
	return value;
}

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}
