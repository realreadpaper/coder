/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
	CodexRuntimeStateMachine,
	createCodexRuntimeMarkerPath
} = require('../../out/codexRuntimeStateMachine');

suite('Codex runtime state machine', () => {
	test('writes started and succeeded markers for a runtime stage', async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-runtime-state-'));
		const markerPath = path.join(dir, 'codex-runtime.json');
		const transitions = [];
		const stateMachine = new CodexRuntimeStateMachine({
			host: 'dev',
			remotePath: '/home/user/project',
			markerPath,
			now: () => '2026-05-05T10:00:00.000Z',
			onTransition: marker => transitions.push(marker)
		});

		const result = await stateMachine.runStage('probe', { platformKey: 'linux-x64' }, async () => 'ok');
		const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));

		assert.strictEqual(result, 'ok');
		assert.deepStrictEqual(transitions.map(transition => `${transition.stage}.${transition.status}`), [
			'probe.started',
			'probe.succeeded'
		]);
		assert.strictEqual(marker.host, 'dev');
		assert.strictEqual(marker.remotePath, '/home/user/project');
		assert.strictEqual(marker.stage, 'probe');
		assert.strictEqual(marker.status, 'succeeded');
		assert.deepStrictEqual(marker.details, { platformKey: 'linux-x64' });
	});

	test('persists failed stage markers with diagnostic errors', async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-runtime-state-'));
		const markerPath = path.join(dir, 'codex-runtime.json');
		const stateMachine = new CodexRuntimeStateMachine({
			host: 'dev',
			remotePath: '/home/user/project',
			markerPath,
			now: () => '2026-05-05T10:00:00.000Z'
		});

		await assert.rejects(() => stateMachine.runStage('install', { version: '0.128.0' }, async () => {
			throw new Error('sha256 mismatch');
		}), /sha256 mismatch/);
		const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));

		assert.strictEqual(marker.stage, 'install');
		assert.strictEqual(marker.status, 'failed');
		assert.strictEqual(marker.error, 'sha256 mismatch');
		assert.deepStrictEqual(marker.details, { version: '0.128.0' });
	});

	test('creates stable marker paths per host and workspace', () => {
		const markerPath = createCodexRuntimeMarkerPath('/tmp/state', 'dev box', '/home/user/project');

		assert.strictEqual(path.dirname(markerPath), path.join('/tmp/state', 'codex-runtime-state'));
		assert.match(path.basename(markerPath), /^dev_box-/);
		assert.match(path.basename(markerPath), /\.json$/);
	});
});
