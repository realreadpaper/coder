/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('assert');
const { chooseAuraRuntimeSource } = require('../../out/auraRuntimeSource');

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
});
