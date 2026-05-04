/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveServerRelease, bundledServerReleaseRoots } = require('../../out/serverRelease');

suite('RemoteAI SSH server release', () => {
	test('prefers explicitly configured tarball', async () => {
		const release = await resolveServerRelease({
			serverTarballPath: '/tmp/vscode-reh-linux-x64.tar.gz',
			commit: 'configured'
		}, {
			extensionPath: '/tmp/app/extensions/our-remote-ssh',
			appCommit: 'bundled'
		});

		assert.deepStrictEqual(release, {
			commit: 'configured',
			tarballPath: '/tmp/vscode-reh-linux-x64.tar.gz',
			source: 'configured-tarball'
		});
	});

	test('resolves bundled manifest from packaged app resources', async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-ai-server-release-'));
		const extensionPath = path.join(root, 'Contents', 'Resources', 'app', 'extensions', 'our-remote-ssh');
		const releaseDir = path.join(root, 'Contents', 'Resources', 'remote-releases', 'abc123');
		fs.mkdirSync(extensionPath, { recursive: true });
		writeManifest(releaseDir, 'abc123');

		const release = await resolveServerRelease({}, {
			extensionPath,
			appCommit: 'abc123456789'
		});

		assert.strictEqual(release.commit, 'abc123');
		assert.strictEqual(release.source, 'bundled-manifest');
		assert.strictEqual(release.tarballPath, path.join(releaseDir, 'vscode-reh-linux-x64.tar.gz'));
	});

	test('resolves dev bundled manifest from source checkout', async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-ai-server-release-'));
		const extensionPath = path.join(root, 'extensions', 'our-remote-ssh');
		const releaseDir = path.join(root, 'remote-releases', 'dev-compat');
		fs.mkdirSync(extensionPath, { recursive: true });
		writeManifest(releaseDir, 'dev-compat');

		const release = await resolveServerRelease({}, {
			extensionPath,
			appCommit: 'unknown'
		});

		assert.strictEqual(release.commit, 'dev-compat');
		assert.strictEqual(release.source, 'bundled-manifest');
		assert.strictEqual(release.tarballPath, path.join(releaseDir, 'vscode-reh-linux-x64.tar.gz'));
	});

	test('returns none when no configured or bundled release exists', async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-ai-server-release-'));
		const extensionPath = path.join(root, 'extensions', 'our-remote-ssh');
		fs.mkdirSync(extensionPath, { recursive: true });

		const release = await resolveServerRelease({ commit: 'manual' }, {
			extensionPath,
			appCommit: 'unknown'
		});

		assert.deepStrictEqual(release, {
			commit: 'manual',
			source: 'none'
		});
	});

	test('knows packaged and source release roots', () => {
		const roots = bundledServerReleaseRoots('/repo/extensions/our-remote-ssh');

		assert.deepStrictEqual(roots, [
			path.resolve('/remote-releases'),
			path.resolve('/repo/remote-releases'),
			path.resolve('/repo/.build/remote-ai-release/remote-releases')
		]);
	});
});

function writeManifest(releaseDir, commit) {
	fs.mkdirSync(releaseDir, { recursive: true });
	fs.writeFileSync(path.join(releaseDir, 'vscode-reh-linux-x64.tar.gz'), 'tarball');
	fs.writeFileSync(path.join(releaseDir, 'manifest.json'), `${JSON.stringify({
		commit,
		platform: 'linux-x64',
		artifact: {
			name: 'vscode-reh-linux-x64.tar.gz',
			sha256: 'a'.repeat(64),
			size: 7
		}
	}, null, 2)}\n`);
}
