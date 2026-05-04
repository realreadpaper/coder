/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('assert');
const {
	codexSecondarySidebarSupportContext,
	codexSidebarPlacementDelays,
	shouldForceCodexSecondarySidebar
} = require('../../out/codexSidebarPlacement');

suite('RemoteAI Codex sidebar placement', () => {
	test('forces OpenAI Codex into the secondary sidebar during startup', () => {
		assert.strictEqual(codexSecondarySidebarSupportContext, 'chatgpt.doesNotSupportSecondarySidebar');
		assert.deepStrictEqual(codexSidebarPlacementDelays, [0, 250, 1000, 3000]);
	});

	test('only forces startup and OpenAI Codex into the secondary sidebar', () => {
		assert.strictEqual(shouldForceCodexSecondarySidebar(undefined), true);
		assert.strictEqual(shouldForceCodexSecondarySidebar('openai.chatgpt'), true);
		assert.strictEqual(shouldForceCodexSecondarySidebar('our.remote-ssh'), false);
	});
});
