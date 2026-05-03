/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRemoteServerManifest, packageRemoteServer, validateRemoteServerTree } = require('../packageServer');

suite('RemoteAI remote server packaging', () => {
	test('validates required Code-OSS remote server files', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-ai-package-'));
		fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
		fs.mkdirSync(path.join(dir, 'out'), { recursive: true });
		fs.writeFileSync(path.join(dir, 'bin', 'remote-ai-server'), '#!/bin/sh\n');
		fs.writeFileSync(path.join(dir, 'node'), 'node');
		fs.writeFileSync(path.join(dir, 'out', 'server-main.js'), 'server');
		fs.writeFileSync(path.join(dir, 'product.json'), '{}');

		assert.deepStrictEqual(validateRemoteServerTree(dir), {
			serverDir: dir,
			requiredFiles: [
				'bin/remote-ai-server',
				'node',
				'out/server-main.js',
				'product.json'
			]
		});
	});

	test('creates manifest with sha256 and compatibility metadata', () => {
		const manifest = createRemoteServerManifest({
			commit: 'dev-compat',
			platform: 'linux-x64',
			tarballName: 'vscode-reh-linux-x64.tar.gz',
			sha256: 'a'.repeat(64),
			size: 42,
			compatibility: {
				minGlibc: '2.17',
				nodeSource: 'cursor-node-20.18.2'
			}
		});

		assert.strictEqual(manifest.schemaVersion, 1);
		assert.strictEqual(manifest.commit, 'dev-compat');
		assert.strictEqual(manifest.platform, 'linux-x64');
		assert.strictEqual(manifest.artifact.sha256, 'a'.repeat(64));
		assert.strictEqual(manifest.compatibility.minGlibc, '2.17');
	});

	test('overlays built-in extensions into packaged server', () => {
		const serverDir = createServerFixture();
		const extensionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-ai-extension-'));
		fs.writeFileSync(path.join(extensionDir, 'package.json'), JSON.stringify({ name: 'ai-codex-remote-bridge' }));
		const releaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-ai-release-'));

		const result = packageRemoteServer({
			sourceDir: serverDir,
			commit: 'dev-test',
			releaseDir,
			includeExtensions: [extensionDir]
		});

		const extractDir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-ai-extract-'));
		require('child_process').execFileSync('tar', ['-xzf', result.tarballPath, '-C', extractDir]);
		assert.strictEqual(
			fs.existsSync(path.join(extractDir, 'vscode-reh-linux-x64', 'extensions', path.basename(extensionDir), 'package.json')),
			true
		);
	});

	test('overlays native modules from a compatibility server source', () => {
		const serverDir = createServerFixture();
		const nativePath = path.join('node_modules', 'node-pty', 'build', 'Release', 'pty.node');
		fs.mkdirSync(path.join(serverDir, path.dirname(nativePath)), { recursive: true });
		fs.writeFileSync(path.join(serverDir, nativePath), 'mach-o-native');

		const compatServerDir = createServerFixture();
		fs.mkdirSync(path.join(compatServerDir, path.dirname(nativePath)), { recursive: true });
		fs.writeFileSync(path.join(compatServerDir, nativePath), 'linux-native');

		const releaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-ai-release-'));
		const result = packageRemoteServer({
			sourceDir: serverDir,
			commit: 'dev-test',
			releaseDir,
			compatServerSourceDir: compatServerDir
		});

		const extractDir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-ai-extract-'));
		require('child_process').execFileSync('tar', ['-xzf', result.tarballPath, '-C', extractDir]);
		assert.strictEqual(
			fs.readFileSync(path.join(extractDir, 'vscode-reh-linux-x64', nativePath), 'utf8'),
			'linux-native'
		);
		assert.strictEqual(
			result.manifest.compatibility.nativeSource,
			path.basename(compatServerDir)
		);
	});
});

function createServerFixture() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-ai-package-'));
	fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
	fs.mkdirSync(path.join(dir, 'out'), { recursive: true });
	fs.writeFileSync(path.join(dir, 'bin', 'remote-ai-server'), '#!/bin/sh\n');
	fs.chmodSync(path.join(dir, 'bin', 'remote-ai-server'), 0o755);
	fs.writeFileSync(path.join(dir, 'node'), 'node');
	fs.writeFileSync(path.join(dir, 'out', 'server-main.js'), 'server');
	fs.writeFileSync(path.join(dir, 'product.json'), '{}');
	return dir;
}
