/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorkspaceSandbox } = require('../../out/workspaceSandbox');

suite('RemoteAI workspace sandbox', () => {
	test('allows paths inside workspace root', async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-ai-sandbox-'));
		fs.mkdirSync(path.join(root, 'src'));
		fs.writeFileSync(path.join(root, 'src', 'a.ts'), '');

		const sandbox = new WorkspaceSandbox(root);
		assert.strictEqual(await sandbox.assertInside(path.join(root, 'src', 'a.ts')), fs.realpathSync(path.join(root, 'src', 'a.ts')));
	});

	test('rejects paths outside workspace root', async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-ai-sandbox-'));
		const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-ai-outside-'));
		const sandbox = new WorkspaceSandbox(root);

		await assert.rejects(() => sandbox.assertInside(outside), /outside workspace/);
	});

	test('rejects symlink escape', async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-ai-sandbox-'));
		const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-ai-outside-'));
		fs.symlinkSync(outside, path.join(root, 'link'));

		const sandbox = new WorkspaceSandbox(root);
		await assert.rejects(() => sandbox.assertInside(path.join(root, 'link')), /outside workspace/);
	});
});
