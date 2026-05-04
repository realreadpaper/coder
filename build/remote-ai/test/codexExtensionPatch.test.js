/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('assert');
const { patchCodexSecondarySidebarGate } = require('../codexExtensionPatch');

suite('Codex extension patch', () => {
	test('lowers Codex secondary sidebar version gate for Code-OSS 1.105', () => {
		const source = 'var L0={major:1,minor:106},XQ="chatgpt.doesNotSupportSecondarySidebar";function n_(t){}';
		const result = patchCodexSecondarySidebarGate(source, 105);

		assert.strictEqual(result.patched, true);
		assert.strictEqual(result.source.includes('L0={major:1,minor:105}'), true);
	});

	test('leaves unrelated bundled JavaScript untouched', () => {
		const source = 'console.log("not codex")';
		const result = patchCodexSecondarySidebarGate(source, 105);

		assert.strictEqual(result.patched, false);
		assert.strictEqual(result.source, source);
	});
});
