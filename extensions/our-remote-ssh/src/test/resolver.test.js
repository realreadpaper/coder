/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { AuditLogWriter } = require('../../out/auditLog');
const { ConnectionManager, resolveSshRemoteAuthority } = require('../../out/resolver');

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

	test('reuses an in-flight connection for the same normalized authority and commit', async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-ai-resolver-'));
		const auditLog = new AuditLogWriter(path.join(dir, 'audit.jsonl'), {
			sessionId: 'resolver-test',
			actor: 'test'
		});
		const manager = new ConnectionManager();
		const calls = [];
		let releaseInstall;
		const installStarted = new Promise(resolve => {
			releaseInstall = resolve;
		});

		const options = {
			commit: 'commit-1',
			connectionToken: 'token-1',
			localTarballPath: '/tmp/server.tar.gz',
			auditLog,
			installServer: async (host, commit) => {
				calls.push(`install:${host}:${commit}`);
				await installStarted;
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
		};

		const first = manager.acquire('ssh-remote+dev', options);
		const second = manager.acquire('ssh-remote%2Bdev', { ...options, connectionToken: 'token-2' });
		releaseInstall();
		const [firstResolved, secondResolved] = await Promise.all([first, second]);

		assert.deepStrictEqual(calls, [
			'install:dev:commit-1',
			'launch:dev:/home/user/.remote-ai-server/bin/commit-1',
			'tunnel:dev:43210'
		]);
		assert.deepStrictEqual(firstResolved.authority, { host: '127.0.0.1', port: 45123, connectionToken: 'token-1' });
		assert.deepStrictEqual(secondResolved.authority, { host: '127.0.0.1', port: 45123, connectionToken: 'token-1' });

		firstResolved.dispose();
		assert.deepStrictEqual(calls, [
			'install:dev:commit-1',
			'launch:dev:/home/user/.remote-ai-server/bin/commit-1',
			'tunnel:dev:43210'
		]);

		secondResolved.dispose();
		assert.deepStrictEqual(calls, [
			'install:dev:commit-1',
			'launch:dev:/home/user/.remote-ai-server/bin/commit-1',
			'tunnel:dev:43210',
			'dispose-tunnel',
			'dispose-server'
		]);
	});

	test('reconnects when a cached connection fails its health check', async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-ai-resolver-'));
		const auditLog = new AuditLogWriter(path.join(dir, 'audit.jsonl'), {
			sessionId: 'resolver-test',
			actor: 'test'
		});
		const manager = new ConnectionManager();
		const calls = [];
		let launchCount = 0;
		let healthy = true;

		const options = {
			commit: 'commit-1',
			connectionToken: 'token-1',
			localTarballPath: '/tmp/server.tar.gz',
			auditLog,
			healthCheck: async () => healthy,
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
				launchCount++;
				const currentLaunch = launchCount;
				calls.push(`launch:${currentLaunch}:${host}:${serverDir}`);
				return {
					endpoint: { host: '127.0.0.1', port: 43210 + currentLaunch },
					dispose() { calls.push(`dispose-server:${currentLaunch}`); }
				};
			},
			openTunnel: async (host, remotePort) => {
				const currentLaunch = launchCount;
				calls.push(`tunnel:${host}:${remotePort}`);
				return {
					localPort: 45123 + currentLaunch,
					remoteHost: '127.0.0.1',
					remotePort,
					dispose() { calls.push(`dispose-tunnel:${currentLaunch}`); }
				};
			}
		};

		const first = await manager.acquire('ssh-remote+dev', options);
		healthy = false;
		const second = await manager.acquire('ssh-remote+dev', { ...options, connectionToken: 'token-2' });

		assert.deepStrictEqual(calls, [
			'install:dev:commit-1',
			'launch:1:dev:/home/user/.remote-ai-server/bin/commit-1',
			'tunnel:dev:43211',
			'dispose-tunnel:1',
			'dispose-server:1',
			'install:dev:commit-1',
			'launch:2:dev:/home/user/.remote-ai-server/bin/commit-1',
			'tunnel:dev:43212'
		]);
		assert.deepStrictEqual(second.authority, { host: '127.0.0.1', port: 45125, connectionToken: 'token-2' });
		first.dispose();
		second.dispose();
	});
});
