/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildCodexExecArgs, spawnCodex } = require('../../out/codexTaskRunner');

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
			'--skip-git-repo-check',
			'Append a smoke line to README.md'
		]);
	});

	test('only bypasses approvals and sandbox when explicitly requested', () => {
		const args = buildCodexExecArgs({
			workspaceRoot: '/home/user/project',
			prompt: 'Append a smoke line to README.md',
			bypassApprovalsAndSandbox: true
		});

		assert.ok(args.includes('--dangerously-bypass-approvals-and-sandbox'));
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
			'--skip-git-repo-check',
			'Clean the local Codex cache'
		]);
	});

	test('stops Codex commands that exceed the output limit', async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-ai-codex-runner-'));
		const codexPath = path.join(dir, 'codex');
		fs.writeFileSync(codexPath, '#!/usr/bin/env sh\nprintf "1234567890"\n', { mode: 0o755 });

		await assert.rejects(() => spawnCodex(codexPath, [], {}, {
			maxOutputBytes: 4
		}), /output exceeded 4 bytes/);
	});

	test('does not prepend the current directory when codex is resolved from PATH', () => {
		const source = require('fs').readFileSync(require('path').join(__dirname, '..', 'codexTaskRunner.ts'), 'utf8');

		assert.ok(source.includes('binDir === \'.\' ? process.env.PATH : extendPath(binDir)'));
	});
});
