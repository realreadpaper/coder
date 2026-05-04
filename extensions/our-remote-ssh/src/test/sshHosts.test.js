/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('assert');
const { parseSshConfig } = require('../../out/sshConfig');
const { createSshConfigEntry, createSshHostOptions, isSshHostPattern } = require('../../out/sshHosts');

suite('RemoteAI SSH host options', () => {
	test('lists configured hosts and keeps default dev fallback', () => {
		const config = parseSshConfig([
			'Host orb',
			'  HostName orb.internal',
			'Host ali',
			'  HostName 203.0.113.10',
			'  User ubuntu',
			'  Port 2222'
		].join('\n'));

		assert.deepStrictEqual(createSshHostOptions(config), [
			{ host: 'ali', description: 'ubuntu@203.0.113.10:2222' },
			{ host: 'orb', description: 'orb.internal' },
			{ host: 'dev', description: 'Default' }
		]);
	});

	test('does not duplicate dev when configured', () => {
		const config = parseSshConfig([
			'Host dev',
			'  HostName 10.0.0.8'
		].join('\n'));

		assert.deepStrictEqual(createSshHostOptions(config), [
			{ host: 'dev', description: '10.0.0.8' }
		]);
	});

	test('filters wildcard ssh host patterns', () => {
		const config = parseSshConfig([
			'Host *',
			'  User shared',
			'Host *.internal',
			'  User shared',
			'Host github.com',
			'  User git'
		].join('\n'));

		assert.deepStrictEqual(createSshHostOptions(config), [
			{ host: 'github.com', description: 'git' },
			{ host: 'dev', description: 'Default' }
		]);
	});

	test('detects ssh host patterns', () => {
		assert.strictEqual(isSshHostPattern('*'), true);
		assert.strictEqual(isSshHostPattern('*.internal'), true);
		assert.strictEqual(isSshHostPattern('dev staging'), true);
		assert.strictEqual(isSshHostPattern('dev'), false);
		assert.strictEqual(isSshHostPattern('user@example.com'), false);
	});

	test('creates ssh config entry from user host input', () => {
		assert.deepStrictEqual(createSshConfigEntry('ubuntu@203.0.113.10:2222'), {
			alias: '203.0.113.10',
			content: [
				'Host 203.0.113.10',
				'  HostName 203.0.113.10',
				'  User ubuntu',
				'  Port 2222',
				''
			].join('\n')
		});
	});

	test('creates ssh config entry from named host input', () => {
		assert.deepStrictEqual(createSshConfigEntry('dev'), {
			alias: 'dev',
			content: [
				'Host dev',
				'  HostName dev',
				''
			].join('\n')
		});
	});
});
