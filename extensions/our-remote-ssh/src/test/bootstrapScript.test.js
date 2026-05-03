/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('assert');
const { createBootstrapScript, parseBootstrapOutput } = require('../../out/bootstrapScript');

suite('RemoteAI bootstrap script', () => {
	test('contains POSIX sh probes and commit-specific server dir', () => {
		const script = createBootstrapScript('abc123');
		assert.match(script, /uname -s/);
		assert.match(script, /uname -m/);
		assert.match(script, /\.remote-ai-server\/bin\/abc123/);
		assert.doesNotMatch(script, /\[\[/);
	});

	test('parses bootstrap output', () => {
		const output = [
			'remoteai-bootstrap-start',
			'remoteai-os=linux',
			'remoteai-arch=x64',
			'remoteai-home=/home/user',
			'remoteai-server-dir=/home/user/.remote-ai-server/bin/abc123',
			'remoteai-server-present=0',
			'remoteai-bootstrap-end'
		].join('\n');

		assert.deepStrictEqual(parseBootstrapOutput(output), {
			os: 'linux',
			arch: 'x64',
			home: '/home/user',
			serverDir: '/home/user/.remote-ai-server/bin/abc123',
			serverPresent: false
		});
	});
});
