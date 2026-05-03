/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REQUIRED_TAR_ENTRIES = [
	'vscode-reh-linux-x64/bin/remote-ai-server',
	'vscode-reh-linux-x64/node',
	'vscode-reh-linux-x64/out/server-main.js',
	'vscode-reh-linux-x64/product.json'
];

function inspectRemoteAiRelease(manifestPath) {
	const resolvedManifestPath = path.resolve(manifestPath);
	const manifest = JSON.parse(fs.readFileSync(resolvedManifestPath, 'utf8'));
	const tarballPath = path.resolve(path.dirname(resolvedManifestPath), manifest.artifact?.name ?? '');
	const errors = [];

	if (!fs.existsSync(tarballPath)) {
		errors.push(`missing tarball: ${tarballPath}`);
		return result(manifest, tarballPath, '', errors);
	}

	const buffer = fs.readFileSync(tarballPath);
	const actualSha256 = crypto.createHash('sha256').update(buffer).digest('hex');
	const expectedSha256 = String(manifest.artifact?.sha256 ?? '').toLowerCase();
	if (expectedSha256 !== actualSha256) {
		errors.push(`sha256 mismatch: expected ${expectedSha256}, got ${actualSha256}`);
	}
	if (manifest.artifact?.size !== buffer.byteLength) {
		errors.push(`size mismatch: expected ${manifest.artifact?.size}, got ${buffer.byteLength}`);
	}

	const entries = new Set(execFileSync('tar', ['-tzf', tarballPath], { encoding: 'utf8' }).trim().split(/\n+/).filter(Boolean));
	for (const entry of REQUIRED_TAR_ENTRIES) {
		if (!entries.has(entry)) {
			errors.push(`missing tar entry: ${entry}`);
		}
	}

	return result(manifest, tarballPath, actualSha256, errors);
}

function result(manifest, tarballPath, sha256, errors) {
	return {
		ok: errors.length === 0,
		errors,
		commit: manifest.commit,
		platform: manifest.platform,
		tarballPath,
		sha256,
		size: manifest.artifact?.size,
		minGlibc: manifest.compatibility?.minGlibc ?? null
	};
}

if (require.main === module) {
	const manifestPath = process.argv[2];
	if (!manifestPath) {
		process.stderr.write('Usage: node build/remote-ai/releaseDoctor.js <manifest.json>\n');
		process.exitCode = 2;
	} else {
		const inspection = inspectRemoteAiRelease(manifestPath);
		process.stdout.write(`${JSON.stringify(inspection, null, '\t')}\n`);
		if (!inspection.ok) {
			process.exitCode = 1;
		}
	}
}

module.exports = {
	REQUIRED_TAR_ENTRIES,
	inspectRemoteAiRelease
};
