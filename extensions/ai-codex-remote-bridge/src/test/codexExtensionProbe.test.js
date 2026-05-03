/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('assert');
const { classifyCodexPackage } = require('../../out/codexExtensionProbe');

suite('Codex extension probe', () => {
	test('detects OpenAI Codex VS Code extension', () => {
		const result = classifyCodexPackage({
			publisher: 'openai',
			name: 'chatgpt',
			displayName: 'Codex - OpenAI coding agent',
			main: './out/extension.js',
			enabledApiProposals: ['chatSessionsProvider']
		});

		assert.strictEqual(result.isCodex, true);
		assert.deepStrictEqual(result.requiredProposals, ['chatSessionsProvider']);
	});

	test('rejects unrelated extensions', () => {
		const result = classifyCodexPackage({
			publisher: 'other',
			name: 'chatgpt',
			main: './out/extension.js'
		});

		assert.strictEqual(result.isCodex, false);
		assert.deepStrictEqual(result.requiredProposals, []);
	});
});
