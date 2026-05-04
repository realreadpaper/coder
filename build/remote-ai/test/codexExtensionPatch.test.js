/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('assert');
const {
	patchCodexPrimarySidebarFallback,
	patchCodexRemoteWorkspaceCwd,
	patchCodexSecondarySidebarGate
} = require('../codexExtensionPatch');

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

	test('disables Codex primary sidebar fallback when secondary sidebar is available', () => {
		const pkg = {
			contributes: {
				viewsContainers: {
					activitybar: [{ id: 'codexViewContainer', when: 'chatgpt.doesNotSupportSecondarySidebar' }],
					secondarySidebar: [{ id: 'codexSecondaryViewContainer', when: '!chatgpt.doesNotSupportSecondarySidebar' }]
				}
			}
		};
		const result = patchCodexPrimarySidebarFallback(pkg);

		assert.strictEqual(result.patched, true);
		assert.strictEqual(pkg.contributes.viewsContainers.activitybar[0].when, 'chatgpt.forcePrimarySidebarDisabled');
	});

	test('forces app-server request cwd to the active SSH workspace', () => {
		const source = 'sendMessage(e){return this.proc.stdin.write(JSON.stringify(e)+`\\n`)}';
		const result = patchCodexRemoteWorkspaceCwd(source);

		assert.strictEqual(result.patched, true);
		assert.match(result.source, /remoteAiWorkspaceCwd/);
		assert.match(result.source, /vscode-remote/);
		assert.match(result.source, /typeof i\.cwd==="string"/);
		assert.doesNotMatch(result.source, /JSON\.stringify\\(e\\)\\+`\\\\n`/);
	});
});
