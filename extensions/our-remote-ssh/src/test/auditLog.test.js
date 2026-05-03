/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { AuditLogWriter } = require('../../out/auditLog');

suite('RemoteAI audit log', () => {
	test('appends traceable JSONL records with hash chain', async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-ai-audit-'));
		const file = path.join(dir, 'audit.jsonl');
		const writer = new AuditLogWriter(file, {
			sessionId: 'session-1',
			actor: 'test'
		});

		await writer.record({
			operation: 'workspace.write',
			status: 'approved',
			authority: 'ssh-remote+dev',
			workspaceRoot: '/home/user/project',
			resource: '/home/user/project/src/a.ts',
			metadata: { bytes: 12 }
		});
		await writer.record({
			operation: 'process.exec',
			status: 'rejected',
			authority: 'ssh-remote+dev',
			workspaceRoot: '/home/user/project',
			metadata: { command: 'rm -rf /' }
		});

		const records = fs.readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line));
		assert.strictEqual(records.length, 2);
		assert.strictEqual(records[0].sequence, 1);
		assert.strictEqual(records[1].sequence, 2);
		assert.strictEqual(records[0].previousHash, null);
		assert.strictEqual(records[1].previousHash, records[0].hash);
		assert.match(records[0].hash, /^[a-f0-9]{64}$/);
		assert.strictEqual(records[0].operation, 'workspace.write');
		assert.strictEqual(records[1].status, 'rejected');
	});
});
