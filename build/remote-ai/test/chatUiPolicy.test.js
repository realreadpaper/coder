/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../../..');

suite('RemoteAI Chat UI policy', () => {
	test('does not expose native chat affordances through command palette or quick access', () => {
		const chatSessions = read('src/vs/workbench/contrib/chat/browser/chatSessions.contribution.ts');
		const commandsQuickAccess = read('src/vs/workbench/contrib/quickaccess/browser/commandsQuickAccess.ts');
		const anythingQuickAccess = read('src/vs/workbench/contrib/search/browser/anythingQuickAccess.ts');
		const editorWatermark = read('src/vs/workbench/browser/parts/editor/editorGroupWatermark.ts');

		assert.doesNotMatch(chatSessions, /f1:\s*true,\s*\/\/ Show in command palette/);
		assert.doesNotMatch(commandsQuickAccess, /Ask \{0\}: \{1\}/);
		assert.doesNotMatch(anythingQuickAccess, /Open Quick Chat/);
		assert.doesNotMatch(editorWatermark, /Open Chat/);
	});
});

function read(relativePath) {
	return fs.readFileSync(path.join(root, relativePath), 'utf8');
}
