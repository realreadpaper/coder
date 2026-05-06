/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('assert');
const { parseSshRemoteAuthority, toSshRemoteAuthority } = require('../../out/authority');

suite('RemoteAI SSH authority', () => {
	test('parses ssh-remote+dev', () => {
		assert.deepStrictEqual(parseSshRemoteAuthority('ssh-remote+dev'), { host: 'dev' });
	});

	test('parses authorities whose remote separator was URI encoded', () => {
		assert.deepStrictEqual(parseSshRemoteAuthority('ssh-remote%2Bdev'), { host: 'dev' });
		assert.deepStrictEqual(parseSshRemoteAuthority('ssh-remote%2bdev'), { host: 'dev' });
	});

	test('encodes host with special characters', () => {
		assert.strictEqual(toSshRemoteAuthority('dev.company.internal'), 'ssh-remote+dev.company.internal');
	});

	test('rejects unsupported authority', () => {
		assert.throws(() => parseSshRemoteAuthority('wsl+Ubuntu'), /Unsupported remote authority/);
	});
});
