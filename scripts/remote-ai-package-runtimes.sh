#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

MANIFEST_PATH="${AURA_RUNTIME_MANIFEST:-$ROOT/resources/aura-code/runtime-manifest.json}"

if [[ ! -f "$MANIFEST_PATH" ]]; then
	echo "missing Aura runtime manifest: $MANIFEST_PATH" >&2
	exit 1
fi

node - "$MANIFEST_PATH" <<'AURA_RUNTIME_NODE'
const fs = require('fs');
const https = require('https');
const path = require('path');

const manifestPath = process.argv[2];
const root = path.dirname(manifestPath);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

function download(url, target) {
	return new Promise((resolve, reject) => {
		fs.mkdirSync(path.dirname(target), { recursive: true });
		const request = https.get(url, response => {
			if (response.statusCode !== 200) {
				response.resume();
				reject(new Error(`download failed ${response.statusCode}: ${url}`));
				return;
			}
			const output = fs.createWriteStream(target);
			response.pipe(output);
			output.on('finish', () => output.close(resolve));
			output.on('error', reject);
		});
		request.on('error', reject);
	});
}

(async () => {
	for (const [providerId, provider] of Object.entries(manifest.providers || {})) {
		for (const [platformKey, platform] of Object.entries(provider.platforms || {})) {
			const target = path.join(root, platform.bundledPath);
			if (fs.existsSync(target)) {
				console.log(`[aura-runtime] exists ${providerId} ${platform.version} ${platformKey}: ${target}`);
				continue;
			}
			const url = platform.officialUrl || platform.mirrorUrl;
			if (!url) {
				throw new Error(`missing download URL for ${providerId} ${platform.version} ${platformKey}`);
			}
			console.log(`[aura-runtime] downloading ${providerId} ${platform.version} ${platformKey}`);
			await download(url, target);
			console.log(`[aura-runtime] wrote ${target}`);
		}
	}
})().catch(error => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
AURA_RUNTIME_NODE
