/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('assert');
const { parseSshConfig } = require('../../out/sshConfig');

suite('RemoteAI SSH config parser', () => {
	test('parses a host entry', () => {
		const config = parseSshConfig([
			'Host dev',
			'  HostName 10.0.0.8',
			'  User hejianglong',
			'  Port 22',
			'  IdentityFile ~/.ssh/id_rsa'
		].join('\n'));
		assert.deepStrictEqual(config.get('dev'), {
			host: 'dev',
			hostName: '10.0.0.8',
			user: 'hejianglong',
			port: 22,
			identityFile: '~/.ssh/id_rsa'
		});
	});

	test('keeps proxy jump and ignores comments', () => {
		const config = parseSshConfig([
			'# production host',
			'Host prod',
			'  HostName prod.internal',
			'  ProxyJump bastion'
		].join('\n'));
		assert.strictEqual(config.get('prod').proxyJump, 'bastion');
	});

	test('creates entries for multiple host aliases', () => {
		const config = parseSshConfig([
			'Host dev dev.internal',
			'  HostName 10.0.0.8',
			'  User hejianglong'
		].join('\n'));
		assert.strictEqual(config.get('dev').hostName, '10.0.0.8');
		assert.strictEqual(config.get('dev.internal').user, 'hejianglong');
	});
});
