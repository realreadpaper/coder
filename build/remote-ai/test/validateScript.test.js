/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('assert');
const fs = require('fs');
const path = require('path');

suite('RemoteAI validation launcher', () => {
	test('keeps Codex UI local and runs the bridge in the workspace host', () => {
		const script = fs.readFileSync(path.join(__dirname, '../../../scripts/remote-ai-validate.sh'), 'utf8');

		assert.match(script, /'remote\.extensionKind':\s*\{/);
		assert.match(script, /openai\.chatgpt/);
		assert.match(script, /'openai\.chatgpt':\s*\['ui'\]/);
		assert.match(script, /'our\.ai-codex-remote-bridge':\s*\['workspace', 'ui'\]/);
	});

	test('loads the locally installed Codex extension and patches it for the right sidebar', () => {
		const script = fs.readFileSync(path.join(__dirname, '../../../scripts/remote-ai-validate.sh'), 'utf8');

		assert.match(script, /REMOTE_AI_VALIDATE_EXTENSIONS_DIR/);
		assert.match(script, /PRODUCT_DATA_FOLDER/);
		assert.match(script, /codexExtensionPatch\.js/);
		assert.match(script, /--extensions-dir/);
	});

	test('prepares a remote Linux Codex binary for remote workspaces', () => {
		const script = fs.readFileSync(path.join(__dirname, '../../../scripts/remote-ai-validate.sh'), 'utf8');

		assert.match(script, /remote-ai-prepare-codex\.sh/);
		assert.match(script, /REMOTE_AI_VALIDATE_REMOTE_CODEX_CLI/);
		assert.match(script, /remoteai\.codex\.remoteCliPath/);
		assert.match(script, /chatgpt\.cliExecutable/);
		assert.match(script, /remote-ai-codex-ssh/);
		assert.match(script, /'chatgpt\.cliExecutable':\s*codexUiWrapperPath/);
		assert.doesNotMatch(script, /remoteai\.codex\.executionMode/);
	});

	test('validate script configures Aura runtime fallback paths', () => {
		const script = fs.readFileSync(path.join(__dirname, '../../../scripts/remote-ai-validate.sh'), 'utf8');

		assert.match(script, /aura\.runtime\.bundledRoot/);
		assert.match(script, /aura\.runtime\.networkEnabled/);
		assert.match(script, /aura\.runtime\.manifestPath/);
		assert.match(script, /0\.128\.0/);
	});
});
