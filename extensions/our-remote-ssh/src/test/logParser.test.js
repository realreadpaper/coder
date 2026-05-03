/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('assert');
const { parseServerListening, parseRemoteAiError } = require('../../out/logParser');

suite('RemoteAI server log parser', () => {
	test('parses listening marker', () => {
		const log = 'RemoteAI Server\nlisteningOn====127.0.0.1:42137====\n';
		assert.deepStrictEqual(parseServerListening(log), { host: '127.0.0.1', port: 42137 });
	});

	test('parses Code-OSS remote extension host listening marker', () => {
		const log = 'Extension host agent listening on 42137\n';
		assert.deepStrictEqual(parseServerListening(log), { host: '127.0.0.1', port: 42137 });
	});

	test('returns undefined when listening marker is absent', () => {
		assert.strictEqual(parseServerListening('starting\n'), undefined);
	});

	test('parses bootstrap style error marker', () => {
		assert.deepStrictEqual(parseRemoteAiError('remoteai-error unsupported-arch=s390x'), {
			code: 'unsupported-arch',
			detail: 's390x'
		});
	});
});
