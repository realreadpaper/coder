/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { AuditLogWriter } = require('../../out/auditLog');
const { launchRemoteServer } = require('../../out/serverLauncher');

suite('RemoteAI server launcher', () => {
	test('starts server over SSH and resolves listening endpoint', async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-ai-launch-'));
		const serverDir = path.join(dir, 'server');
		const binDir = path.join(serverDir, 'bin');
		fs.mkdirSync(binDir, { recursive: true });
		fs.writeFileSync(path.join(binDir, 'remote-ai-server'), `#!/usr/bin/env sh
echo "booting synthetic server"
echo "listeningOn====127.0.0.1:42137===="
sleep 20
`, { mode: 0o755 });

		const sshPath = path.join(dir, 'ssh');
		fs.writeFileSync(sshPath, `#!/usr/bin/env sh
if [ "$1" = "-T" ]; then
	shift
fi
shift
exec sh -c "$*"
`, { mode: 0o755 });

		const auditPath = path.join(dir, 'audit.jsonl');
		const auditLog = new AuditLogWriter(auditPath, {
			sessionId: 'launch-test',
			actor: 'test'
		});

		const launched = await launchRemoteServer('dev', serverDir, auditLog, {
			sshPath,
			timeoutMs: 3000,
			connectionToken: 'token-1'
		});
		launched.dispose();

		const records = fs.readFileSync(auditPath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
		assert.deepStrictEqual(launched.endpoint, { host: '127.0.0.1', port: 42137 });
		assert.deepStrictEqual(records.map(record => `${record.operation}.${record.status}`), [
			'server.launch.started',
			'server.launch.succeeded'
		]);
	});

	test('fails when server does not print listening marker', async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-ai-launch-'));
		const serverDir = path.join(dir, 'server');
		const binDir = path.join(serverDir, 'bin');
		fs.mkdirSync(binDir, { recursive: true });
		fs.writeFileSync(path.join(binDir, 'remote-ai-server'), '#!/usr/bin/env sh\necho no-listener\nsleep 20\n', { mode: 0o755 });

		const sshPath = path.join(dir, 'ssh');
		fs.writeFileSync(sshPath, `#!/usr/bin/env sh
if [ "$1" = "-T" ]; then
	shift
fi
shift
exec sh -c "$*"
`, { mode: 0o755 });

		const auditLog = new AuditLogWriter(path.join(dir, 'audit.jsonl'), {
			sessionId: 'launch-test',
			actor: 'test'
		});

		await assert.rejects(() => launchRemoteServer('dev', serverDir, auditLog, {
			sshPath,
			timeoutMs: 20,
			connectionToken: 'token-1'
		}), /timed out/);
	});
});
