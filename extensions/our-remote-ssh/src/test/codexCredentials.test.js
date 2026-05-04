/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('assert');
const {
	buildCodexCredentialSyncPayload,
	buildCodexCredentialSyncScript,
	codexCredentialRelativePaths
} = require('../../out/codexCredentials');

suite('RemoteAI Codex credentials', () => {
	test('only syncs auth and config files', () => {
		assert.deepStrictEqual(codexCredentialRelativePaths, ['auth.json', 'config.toml']);
	});

	test('encodes credential payload without changing filenames', () => {
		assert.deepStrictEqual(buildCodexCredentialSyncPayload([
			{ relativePath: 'auth.json', content: '{"token":"secret"}', mode: 0o600 },
			{ relativePath: 'config.toml', content: 'model = "gpt-5"', mode: 0o600 }
		]), {
			files: [
				{ relativePath: 'auth.json', contentBase64: Buffer.from('{"token":"secret"}').toString('base64'), mode: 0o600 },
				{ relativePath: 'config.toml', contentBase64: Buffer.from('model = "gpt-5"').toString('base64'), mode: 0o600 }
			]
		});
	});

	test('sync script reads payload from stdin and does not contain secrets', () => {
		const script = buildCodexCredentialSyncScript({
			remoteCodexHome: '/home/user/.codex',
			overwrite: false
		});
		assert.match(script, /process\.stdin/);
		assert.match(script, /existsSync/);
		assert.match(script, /chmodSync/);
		assert.doesNotMatch(script, /secret/);
	});
});
