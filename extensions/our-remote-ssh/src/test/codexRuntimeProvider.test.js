/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('assert');
const {
	createCodexRuntimeInstallTarget,
	legacyCodexRemoteCliPath
} = require('../../out/codexRuntimeProvider');

suite('Codex runtime provider', () => {
	test('creates Aura Code install target for linux x64', () => {
		const target = createCodexRuntimeInstallTarget({
			home: '/home/user',
			platformKey: 'linux-x64',
			version: '0.128.0',
			binRelativePath: 'package/vendor/x86_64-unknown-linux-musl/codex/codex'
		});
		assert.strictEqual(target.installDir, '/home/user/.aura-code/runtimes/codex/0.128.0-linux-x64');
		assert.strictEqual(target.binPath, '/home/user/.aura-code/runtimes/codex/0.128.0-linux-x64/package/vendor/x86_64-unknown-linux-musl/codex/codex');
		assert.strictEqual(target.uploadPath, '/home/user/.aura-code/upload/codex-0.128.0-linux-x64.tar.gz');
	});

	test('knows legacy remote path for compatibility', () => {
		assert.strictEqual(
			legacyCodexRemoteCliPath('/home/user', '0.128.0', 'linux-x64'),
			'/home/user/.remote-ai-server/codex/0.128.0-linux-x64/bin/codex'
		);
	});
});
