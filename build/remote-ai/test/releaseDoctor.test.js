/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { inspectRemoteAiRelease } = require('../releaseDoctor');

suite('RemoteAI release doctor', () => {
	test('accepts a release with matching sha and required server entries', () => {
		const releaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-ai-release-doctor-'));
		const tarballPath = createTarball(releaseDir, [
			'vscode-reh-linux-x64/bin/remote-ai-server',
			'vscode-reh-linux-x64/node',
			'vscode-reh-linux-x64/out/server-main.js',
			'vscode-reh-linux-x64/product.json'
		]);
		const sha256 = sha256File(tarballPath);
		const manifestPath = writeManifest(releaseDir, sha256, fs.statSync(tarballPath).size);

		const result = inspectRemoteAiRelease(manifestPath);

		assert.deepStrictEqual(result.errors, []);
		assert.strictEqual(result.ok, true);
		assert.strictEqual(result.commit, 'dev-compat');
		assert.strictEqual(result.tarballPath, tarballPath);
		assert.strictEqual(result.sha256, sha256);
	});

	test('reports sha mismatch and missing required entries', () => {
		const releaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-ai-release-doctor-'));
		createTarball(releaseDir, [
			'vscode-reh-linux-x64/bin/remote-ai-server',
			'vscode-reh-linux-x64/product.json'
		]);
		const manifestPath = writeManifest(releaseDir, '0'.repeat(64), 1);

		const result = inspectRemoteAiRelease(manifestPath);

		assert.strictEqual(result.ok, false);
		assert.ok(result.errors.some(error => error.includes('sha256 mismatch')));
		assert.ok(result.errors.some(error => error.includes('missing tar entry: vscode-reh-linux-x64/node')));
		assert.ok(result.errors.some(error => error.includes('missing tar entry: vscode-reh-linux-x64/out/server-main.js')));
	});
});

function createTarball(releaseDir, entries) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-ai-release-tree-'));
	for (const entry of entries) {
		const fullPath = path.join(root, entry);
		fs.mkdirSync(path.dirname(fullPath), { recursive: true });
		fs.writeFileSync(fullPath, entry);
		if (entry.endsWith('/remote-ai-server') || entry.endsWith('/node')) {
			fs.chmodSync(fullPath, 0o755);
		}
	}
	const tarballPath = path.join(releaseDir, 'vscode-reh-linux-x64.tar.gz');
	execFileSync('tar', ['-czf', tarballPath, '-C', root, 'vscode-reh-linux-x64']);
	return tarballPath;
}

function writeManifest(releaseDir, sha256, size) {
	const manifestPath = path.join(releaseDir, 'manifest.json');
	fs.writeFileSync(manifestPath, `${JSON.stringify({
		schemaVersion: 1,
		commit: 'dev-compat',
		platform: 'linux-x64',
		artifact: {
			name: 'vscode-reh-linux-x64.tar.gz',
			sha256,
			size
		},
		compatibility: {
			minGlibc: '2.17'
		}
	}, null, '\t')}\n`);
	return manifestPath;
}

function sha256File(file) {
	return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
