/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('assert');
const { createDiagnosticsReport } = require('../../out/diagnostics');

suite('RemoteAI diagnostics', () => {
	test('renders configured release and host facts', () => {
		const report = createDiagnosticsReport({
			now: '2026-05-03T10:00:00.000Z',
			appName: 'Aura',
			appCommit: 'dev',
			remoteName: undefined,
			workspaceFolders: ['file:///workspace'],
			configuration: {
				serverManifestPath: '/release/manifest.json',
				serverTarballPath: '',
				commit: 'dev-compat',
				sshPath: 'ssh',
				defaultRemotePath: '/home/dev/project'
			},
			hostOptions: ['dev', 'prod'],
			recentConnections: [{ host: 'dev', remotePath: '/home/dev/project', lastUsed: '2026-05-03T09:00:00.000Z' }],
			auditPath: '/audit/remote-ai-audit.jsonl',
			manifest: {
				ok: true,
				commit: 'dev-compat',
				platform: 'linux-x64',
				tarballPath: '/release/vscode-reh-linux-x64.tar.gz',
				sha256: 'a'.repeat(64),
				size: 123,
				minGlibc: '2.17',
				errors: []
			}
		});

		assert.ok(report.includes('# Aura Diagnostics'));
		assert.ok(report.includes('- App: Aura'));
		assert.ok(report.includes('- Manifest: ok'));
		assert.ok(report.includes('- Tarball: /release/vscode-reh-linux-x64.tar.gz'));
		assert.ok(report.includes('- SSH hosts: dev, prod'));
		assert.ok(report.includes('- Recent: dev /home/dev/project'));
	});

	test('renders manifest errors without throwing', () => {
		const report = createDiagnosticsReport({
			now: '2026-05-03T10:00:00.000Z',
			appName: 'Aura',
			appCommit: 'dev',
			remoteName: 'ssh-remote',
			workspaceFolders: [],
			configuration: {
				serverManifestPath: '/missing/manifest.json',
				serverTarballPath: '',
				commit: '',
				sshPath: 'ssh',
				defaultRemotePath: '~'
			},
			hostOptions: [],
			recentConnections: [],
			auditPath: '/audit/remote-ai-audit.jsonl',
			manifest: {
				ok: false,
				errors: ['missing manifest: /missing/manifest.json']
			}
		});

		assert.ok(report.includes('- Remote name: ssh-remote'));
		assert.ok(report.includes('- Manifest: failed'));
		assert.ok(report.includes('  - missing manifest: /missing/manifest.json'));
		assert.ok(report.includes('- SSH hosts: none'));
	});
});
