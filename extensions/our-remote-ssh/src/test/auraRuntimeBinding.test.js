/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('assert');
const {
	createAuraRuntimeEnsurePlan
} = require('../../out/auraRuntimeBinding');

suite('Aura runtime binding', () => {
	test('uses existing remote registry Codex when version matches', () => {
		const plan = createAuraRuntimeEnsurePlan({
			providerId: 'codex',
			home: '/home/user',
			platformKey: 'linux-x64',
			configuredRemoteCliPath: '',
			registry: {
				runtimes: {
					codex: {
						version: '0.128.0',
						binPath: '/home/user/.aura-code/runtimes/codex/0.128.0-linux-x64/bin/codex'
					}
				}
			},
			requiredVersion: '0.128.0',
			binRelativePath: 'package/vendor/x86_64-unknown-linux-musl/codex/codex'
		});
		assert.deepStrictEqual(plan, {
			action: 'use-existing',
			binPath: '/home/user/.aura-code/runtimes/codex/0.128.0-linux-x64/bin/codex'
		});
	});

	test('respects explicit remoteCliPath configuration', () => {
		const plan = createAuraRuntimeEnsurePlan({
			providerId: 'codex',
			home: '/home/user',
			platformKey: 'linux-x64',
			configuredRemoteCliPath: '/custom/bin/codex',
			registry: { runtimes: {} },
			requiredVersion: '0.128.0',
			binRelativePath: 'package/vendor/x86_64-unknown-linux-musl/codex/codex'
		});
		assert.deepStrictEqual(plan, {
			action: 'use-configured',
			binPath: '/custom/bin/codex'
		});
	});

	test('rejects relative remoteCliPath configuration', () => {
		assert.throws(() => createAuraRuntimeEnsurePlan({
			providerId: 'codex',
			home: '/home/user',
			platformKey: 'linux-x64',
			configuredRemoteCliPath: 'codex',
			registry: { runtimes: {} },
			requiredVersion: '0.128.0',
			binRelativePath: 'package/vendor/x86_64-unknown-linux-musl/codex/codex'
		}), /absolute remote path/);
	});

	test('plans install when registry is missing', () => {
		const plan = createAuraRuntimeEnsurePlan({
			providerId: 'codex',
			home: '/home/user',
			platformKey: 'linux-x64',
			configuredRemoteCliPath: '',
			registry: { runtimes: {} },
			requiredVersion: '0.128.0',
			binRelativePath: 'package/vendor/x86_64-unknown-linux-musl/codex/codex'
		});
		assert.strictEqual(plan.action, 'install');
		assert.strictEqual(plan.target.binPath, '/home/user/.aura-code/runtimes/codex/0.128.0-linux-x64/package/vendor/x86_64-unknown-linux-musl/codex/codex');
	});
});
