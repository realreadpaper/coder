/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('assert');
const { codexPlatformPackage, createCodexCliInstallPlan } = require('../../out/codexCliInstaller');

suite('Codex CLI installer', () => {
	test('selects linux x64 package spec', () => {
		assert.strictEqual(codexPlatformPackage('linux', 'x64', '0.128.0'), '@openai/codex@0.128.0-linux-x64');
	});

	test('selects linux arm64 package spec', () => {
		assert.strictEqual(codexPlatformPackage('linux', 'arm64', '0.128.0'), '@openai/codex@0.128.0-linux-arm64');
	});

	test('rejects non-linux remote platforms', () => {
		assert.throws(() => codexPlatformPackage('darwin', 'x64'), /Remote Codex CLI must be Linux/);
	});

	test('creates Aura Code install plan rooted in remote home', () => {
		const plan = createCodexCliInstallPlan('/home/user/.remote-ai-server/User/globalStorage/our.ai-codex-remote-bridge', 'linux', 'x64', '0.128.0', '/home/user');
		assert.strictEqual(plan.packageName, '@openai/codex@0.128.0-linux-x64');
		assert.strictEqual(plan.binPath, '/home/user/.aura-code/runtimes/codex/0.128.0-linux-x64/bin/codex');
		assert.strictEqual(plan.binaryRelativePath, 'bin/codex');
	});
});
