/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('assert');
const { createAppendPatchPreview } = require('../../out/codexPatchPreview');

suite('RemoteAI Codex patch', () => {
	test('creates append diff preview', () => {
		const diff = createAppendPatchPreview('README.md', 'hello\n', '\nchanged\n');
		assert.match(diff, /--- README.md/);
		assert.match(diff, /\+\+\+ README.md/);
		assert.match(diff, / hello/);
		assert.match(diff, /\+changed/);
	});
});
