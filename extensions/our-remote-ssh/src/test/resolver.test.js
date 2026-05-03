/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { AuditLogWriter } = require('../../out/auditLog');
const { resolveSshRemoteAuthority } = require('../../out/resolver');

suite('RemoteAI SSH resolver', () => {
	test('runs install, launch and tunnel in order', async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-ai-resolver-'));
		const auditLog = new AuditLogWriter(path.join(dir, 'audit.jsonl'), {
			sessionId: 'resolver-test',
			actor: 'test'
		});
		const calls = [];

		const resolved = await resolveSshRemoteAuthority('ssh-remote+dev', {
			commit: 'commit-1',
			connectionToken: 'token-1',
			localTarballPath: '/tmp/server.tar.gz',
			auditLog,
			installServer: async (host, commit) => {
				calls.push(`install:${host}:${commit}`);
				return {
					host,
					commit,
					platform: 'linux-x64',
					home: '/home/user',
					serverDir: '/home/user/.remote-ai-server/bin/commit-1',
					installed: true
				};
			},
			launchServer: async (host, serverDir) => {
				calls.push(`launch:${host}:${serverDir}`);
				return {
					endpoint: { host: '127.0.0.1', port: 43210 },
					dispose() { calls.push('dispose-server'); }
				};
			},
			openTunnel: async (host, remotePort) => {
				calls.push(`tunnel:${host}:${remotePort}`);
				return {
					localPort: 45123,
					remoteHost: '127.0.0.1',
					remotePort,
					dispose() { calls.push('dispose-tunnel'); }
				};
			}
		});

		resolved.dispose();

		assert.deepStrictEqual(calls, [
			'install:dev:commit-1',
			'launch:dev:/home/user/.remote-ai-server/bin/commit-1',
			'tunnel:dev:43210',
			'dispose-tunnel',
			'dispose-server'
		]);
		assert.deepStrictEqual(resolved.authority, { host: '127.0.0.1', port: 45123, connectionToken: 'token-1' });
	});

	test('fails when no tarball is configured for a missing server', async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-ai-resolver-'));
		const auditLog = new AuditLogWriter(path.join(dir, 'audit.jsonl'), {
			sessionId: 'resolver-test',
			actor: 'test'
		});

		await assert.rejects(() => resolveSshRemoteAuthority('ssh-remote+dev', {
			commit: 'commit-1',
			connectionToken: 'token-1',
			auditLog
		}), /remoteai.ssh.serverTarballPath/);
	});
});
