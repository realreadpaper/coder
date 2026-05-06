/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { AuditLogWriter } = require('../../out/auditLog');
const { openSshTunnel } = require('../../out/tunnelManager');

suite('RemoteAI tunnel manager', () => {
	test('starts ssh local forwarding with expected arguments', async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-ai-tunnel-'));
		const argsPath = path.join(dir, 'ssh-args.txt');
		const sshPath = path.join(dir, 'ssh');
		fs.writeFileSync(sshPath, `#!/usr/bin/env sh
printf "%s\\n" "$@" > "${argsPath}"
sleep 20
`, { mode: 0o755 });

		const auditPath = path.join(dir, 'audit.jsonl');
		const auditLog = new AuditLogWriter(auditPath, {
			sessionId: 'tunnel-test',
			actor: 'test'
		});

		const tunnel = await openSshTunnel('dev', 43210, auditLog, {
			sshPath,
			localPort: 45123,
			skipReadyCheck: true
		});
		await waitForFileLine(argsPath, 'dev');
		tunnel.dispose();

		const args = fs.readFileSync(argsPath, 'utf8').trim().split('\n');
		const records = fs.readFileSync(auditPath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
		assert.ok(args.includes('ControlMaster=auto'));
		assert.ok(args.includes('ControlPersist=10m'));
		assert.ok(args.some(arg => arg.startsWith('ControlPath=')));
		assert.ok(args.includes('ConnectTimeout=10'));
		assert.deepStrictEqual(args.slice(-4), [
			'-N',
			'-L',
			'127.0.0.1:45123:127.0.0.1:43210',
			'dev'
		]);
		assert.strictEqual(tunnel.localPort, 45123);
		assert.deepStrictEqual(records.map(record => `${record.operation}.${record.status}`), [
			'tunnel.open.started',
			'tunnel.open.succeeded'
		]);
	});
});

async function waitForFileLine(filePath, expectedLine) {
	const deadline = Date.now() + 5000;
	while (Date.now() < deadline) {
		if (fs.existsSync(filePath)) {
			const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n');
			if (lines.includes(expectedLine)) {
				return;
			}
		}
		await new Promise(resolve => setTimeout(resolve, 10));
	}
	throw new Error(`Timed out waiting for ${expectedLine} in ${filePath}`);
}
