/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('assert');
const path = require('path');
const {
	createRemoteCodexTaskPlan,
	defaultRemoteCodexStateRoot,
	resolveRemoteCodexPath
} = require('../../out/remoteCodexRunner');

suite('Remote Codex runner', () => {
	test('builds a remote workspace task plan rooted in the remote workspace', () => {
		const plan = createRemoteCodexTaskPlan({
			workspaceRoot: '/home/user/project',
			prompt: 'Append a smoke line',
			sandboxMode: 'workspace-write',
			remoteCliPath: '/home/user/.remote-ai-server/User/globalStorage/our.ai-codex-remote-bridge/codex-cli/0.128.0-linux-x64/bin/codex',
			globalStoragePath: '/home/user/.remote-ai-server/User/globalStorage/our.ai-codex-remote-bridge'
		});

		assert.strictEqual(plan.codexPath, '/home/user/.remote-ai-server/User/globalStorage/our.ai-codex-remote-bridge/codex-cli/0.128.0-linux-x64/bin/codex');
		assert.strictEqual(plan.workspaceRoot, '/home/user/project');
		assert.strictEqual(plan.outputLastMessagePath, '/home/user/project/.remote-ai-codex/last-message.md');
		assert.deepStrictEqual(plan.additionalWritableRoots, [
			'/home/user/.remote-ai-server/User/globalStorage/our.ai-codex-remote-bridge'
		]);
	});

	test('uses configured remote CLI path before installer path', () => {
		const codexPath = resolveRemoteCodexPath({
			remoteCliPath: '/opt/codex/bin/codex',
			globalStoragePath: '/home/user/.remote-ai-server/User/globalStorage/our.ai-codex-remote-bridge',
			platform: 'linux',
			arch: 'x64'
		});

		assert.strictEqual(codexPath, '/opt/codex/bin/codex');
	});

	test('uses Linux installer path when remote CLI path is empty', () => {
		const codexPath = resolveRemoteCodexPath({
			remoteCliPath: '',
			globalStoragePath: '/home/user/.remote-ai-server/User/globalStorage/our.ai-codex-remote-bridge',
			platform: 'linux',
			arch: 'x64'
		});

		assert.strictEqual(codexPath, '/home/user/.remote-ai-server/User/globalStorage/our.ai-codex-remote-bridge/codex-cli/0.128.0-linux-x64/bin/codex');
	});

	test('rejects non-Linux remote platforms', () => {
		assert.throws(() => resolveRemoteCodexPath({
			remoteCliPath: '',
			globalStoragePath: '/Users/user/Library/Application Support/RemoteAI',
			platform: 'darwin',
			arch: 'arm64'
		}), /Remote Codex CLI must be Linux/);
	});

	test('uses a remote-side Codex state root', () => {
		assert.strictEqual(
			defaultRemoteCodexStateRoot('/home/user/.remote-ai-server/User/globalStorage/our.ai-codex-remote-bridge'),
			'/home/user/.remote-ai-server/User/globalStorage/our.ai-codex-remote-bridge'
		);
	});

	test('does not expose removed synchronization concepts', () => {
		const sourcePath = path.join(__dirname, '../../out/remoteCodexRunner.js');
		const source = require('fs').readFileSync(sourcePath, 'utf8');
		for (const pattern of [
			'rsy' + 'nc',
			'local-' + 'remote-workspaces',
			'local ' + 'mirror',
			'runLocalCodexRemote' + 'WorkspaceTask'
		]) {
			assert.doesNotMatch(source, new RegExp(pattern));
		}
	});
});
