/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chooseAuraRuntimeSource, hashAuraRuntimeFile } = require('../../out/auraRuntimeSource');

suite('Aura runtime source', () => {
	test('uses local cache before network sources', () => {
		const source = chooseAuraRuntimeSource({
			providerId: 'codex',
			platformKey: 'linux-x64',
			version: '0.128.0',
			cachePath: '/cache/codex/0.128.0-linux-x64.tar.gz',
			cacheExists: true,
			bundledPath: '/app/runtimes/codex/0.128.0-linux-x64.tar.gz',
			bundledExists: true,
			officialUrl: 'https://official.invalid/codex.tar.gz',
			mirrorUrl: 'https://mirror.invalid/codex.tar.gz',
			networkAvailable: true
		});
		assert.deepStrictEqual(source, {
			kind: 'cache',
			path: '/cache/codex/0.128.0-linux-x64.tar.gz'
		});
	});

	test('uses official URL before mirror when cache is missing', () => {
		const source = chooseAuraRuntimeSource({
			providerId: 'codex',
			platformKey: 'linux-x64',
			version: '0.128.0',
			cachePath: '/cache/codex/0.128.0-linux-x64.tar.gz',
			cacheExists: false,
			bundledPath: '/app/runtimes/codex/0.128.0-linux-x64.tar.gz',
			bundledExists: true,
			officialUrl: 'https://official.invalid/codex.tar.gz',
			mirrorUrl: 'https://mirror.invalid/codex.tar.gz',
			networkAvailable: true
		});
		assert.deepStrictEqual(source, {
			kind: 'download',
			url: 'https://official.invalid/codex.tar.gz',
			cachePath: '/cache/codex/0.128.0-linux-x64.tar.gz'
		});
	});

	test('uses bundled fallback when offline', () => {
		const source = chooseAuraRuntimeSource({
			providerId: 'codex',
			platformKey: 'linux-x64',
			version: '0.128.0',
			cachePath: '/cache/codex/0.128.0-linux-x64.tar.gz',
			cacheExists: false,
			bundledPath: '/app/runtimes/codex/0.128.0-linux-x64.tar.gz',
			bundledExists: true,
			officialUrl: 'https://official.invalid/codex.tar.gz',
			mirrorUrl: 'https://mirror.invalid/codex.tar.gz',
			networkAvailable: false
		});
		assert.deepStrictEqual(source, {
			kind: 'bundled',
			path: '/app/runtimes/codex/0.128.0-linux-x64.tar.gz'
		});
	});

	test('reports unsupported offline platform clearly', () => {
		assert.throws(() => chooseAuraRuntimeSource({
			providerId: 'codex',
			platformKey: 'linux-arm64',
			version: '0.128.0',
			cachePath: '/cache/codex/0.128.0-linux-arm64.tar.gz',
			cacheExists: false,
			bundledPath: '/app/runtimes/codex/0.128.0-linux-arm64.tar.gz',
			bundledExists: false,
			officialUrl: '',
			mirrorUrl: '',
			networkAvailable: false
		}), /No Aura runtime source available for codex 0.128.0 linux-arm64/);
	});

	test('hashes runtime files with sha256', async () => {
		const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'aura-runtime-'));
		const file = path.join(dir, 'runtime.tar.gz');
		await fs.promises.writeFile(file, 'codex-runtime');
		const hash = await hashAuraRuntimeFile(file);
		assert.strictEqual(hash, 'fc8f82d54f407266e72d07b7222ccda5eccb619d5526cf84580c2a6ab6f2e772');
	});
});
