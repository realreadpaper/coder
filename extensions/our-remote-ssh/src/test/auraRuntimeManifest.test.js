/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('assert');
const {
	defaultAuraRuntimeManifest,
	parseAuraRuntimeManifest,
	selectProviderPlatform
} = require('../../out/auraRuntimeManifest');

suite('Aura runtime manifest', () => {
	test('provides Codex 0.128.0 fallback for linux x64', () => {
		const platform = selectProviderPlatform(defaultAuraRuntimeManifest, 'codex', 'linux-x64');
		assert.strictEqual(platform.version, '0.128.0');
		assert.strictEqual(platform.officialUrl, 'https://registry.npmjs.org/@openai/codex/-/codex-0.128.0-linux-x64.tgz');
		assert.strictEqual(platform.binPath, 'package/vendor/x86_64-unknown-linux-musl/codex/codex');
		assert.strictEqual(platform.bundledPath, 'runtimes/codex/0.128.0-linux-x64.tar.gz');
	});

	test('rejects invalid sha256 values', () => {
		assert.throws(() => parseAuraRuntimeManifest({
			schemaVersion: 1,
			providers: {
				codex: {
					displayName: 'Codex',
					recommendedVersion: '0.128.0',
					minimumVersion: '0.128.0',
					bundledFallbackVersion: '0.128.0',
					commands: { sidebar: 'app-server', exec: 'exec' },
					platforms: {
						'linux-x64': {
							version: '0.128.0',
							officialUrl: '',
							mirrorUrl: '',
							sha256: 'bad',
							size: 1,
							binPath: 'bin/codex',
							bundledPath: 'runtimes/codex/0.128.0-linux-x64.tar.gz'
						}
					}
				}
			}
		}), /invalid sha256/);
	});

	test('rejects missing provider platform', () => {
		assert.throws(() => selectProviderPlatform(defaultAuraRuntimeManifest, 'codex', 'linux-s390x'), /does not support linux-s390x/);
	});
});
