/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('assert');
const { buildCodexExecArgs } = require('../../out/codexTaskRunner');

suite('Codex task runner', () => {
	test('builds a remote workspace exec command using local Codex config defaults', () => {
		const args = buildCodexExecArgs({
			workspaceRoot: '/home/user/project',
			prompt: 'Append a smoke line to README.md'
		});

		assert.deepStrictEqual(args, [
			'exec',
			'--cd',
			'/home/user/project',
			'--sandbox',
			'danger-full-access',
			'--dangerously-bypass-approvals-and-sandbox',
			'--skip-git-repo-check',
			'Append a smoke line to README.md'
		]);
	});

	test('can write the last message to a known report path', () => {
		const args = buildCodexExecArgs({
			workspaceRoot: '/home/user/project',
			prompt: 'Summarize',
			outputLastMessagePath: '/home/user/project/.remote-ai-codex/last-message.md'
		});

		assert.deepStrictEqual(args.slice(-3), [
			'--output-last-message',
			'/home/user/project/.remote-ai-codex/last-message.md',
			'Summarize'
		]);
	});

	test('adds extra writable roots for workspace-write sandbox', () => {
		const args = buildCodexExecArgs({
			workspaceRoot: '/Users/user/project',
			prompt: 'Clean the local Codex cache',
			sandboxMode: 'workspace-write',
			additionalWritableRoots: [
				'/Users/user/.remote-ai-server',
				'/Users/user/.remote-ai-server'
			]
		});

		assert.deepStrictEqual(args, [
			'exec',
			'--cd',
			'/Users/user/project',
			'--sandbox',
			'workspace-write',
			'--add-dir',
			'/Users/user/.remote-ai-server',
			'--dangerously-bypass-approvals-and-sandbox',
			'--skip-git-repo-check',
			'Clean the local Codex cache'
		]);
	});
});
