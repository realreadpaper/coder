/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('assert');
const fs = require('fs');
const path = require('path');

suite('Aura Codex UI automation', () => {
	test('uses Aura as the visible SSH extension name', () => {
		const pkg = require('../../package.json');

		assert.strictEqual(pkg.displayName, 'Aura SSH');
		assert.strictEqual(pkg.contributes.configuration.title, 'Aura SSH');
		for (const command of pkg.contributes.commands) {
			assert.strictEqual(command.category, 'Aura');
		}
		assert.strictEqual(
			pkg.contributes.resourceLabelFormatters[0].formatting.workspaceTooltip,
			'Aura SSH'
		);
	});

	test('preconfigures Codex before opening the SSH workspace', () => {
		const extensionSource = fs.readFileSync(path.join(__dirname, '..', 'extension.ts'), 'utf8');
		const configureIndex = extensionSource.indexOf('await configureCodexUiForSshTarget(context, output, auditLog, codexRuntimeStatus, host, remotePath);');
		const openIndex = extensionSource.indexOf('await openRemoteFolder(host, remotePath);');

		assert.ok(configureIndex > -1);
		assert.ok(openIndex > -1);
		assert.ok(configureIndex < openIndex);
	});

	test('does not reload after configuring the Codex sidebar', () => {
		const extensionSource = fs.readFileSync(path.join(__dirname, '..', 'extension.ts'), 'utf8');

		assert.ok(!extensionSource.includes('workbench.action.reloadWindow'));
		assert.ok(!extensionSource.includes('\'Reload Window\''));
		assert.ok(!extensionSource.includes('RemoteAI configured the Codex sidebar'));
	});

	test('does not continue with a bare codex wrapper when runtime binding fails', () => {
		const extensionSource = fs.readFileSync(path.join(__dirname, '..', 'extension.ts'), 'utf8');
		const failureIndex = extensionSource.indexOf('Aura Code runtime binding failed');
		const unavailableIndex = extensionSource.indexOf('buildUnavailableCodexSshWrapperScript', failureIndex);
		const writeWrapperIndex = extensionSource.indexOf('await fs.promises.writeFile(plan.wrapperPath, plan.script', failureIndex);

		assert.ok(failureIndex > -1);
		assert.ok(unavailableIndex > -1);
		assert.ok(writeWrapperIndex > -1);
		assert.ok(failureIndex < unavailableIndex);
		assert.ok(unavailableIndex < writeWrapperIndex);
	});

	test('shows remote Codex runtime activation status in the status bar', () => {
		const extensionSource = fs.readFileSync(path.join(__dirname, '..', 'extension.ts'), 'utf8');

		assert.ok(extensionSource.includes('createStatusBarItem(vscode.StatusBarAlignment.Right'));
		assert.ok(extensionSource.includes('Aura Codex: checking'));
		assert.ok(extensionSource.includes('Aura Codex: remote active'));
		assert.ok(extensionSource.includes('Aura Codex: remote unavailable'));
		assert.ok(extensionSource.includes('Remote Codex CLI'));
	});

	test('falls back to direct settings write when Codex CLI setting is not registered yet', () => {
		const extensionSource = fs.readFileSync(path.join(__dirname, '..', 'extension.ts'), 'utf8');

		assert.ok(extensionSource.includes('setChatGptCliExecutable'));
		assert.ok(extensionSource.includes('writeChatGptCliExecutableFallback'));
		assert.ok(extensionSource.includes('chatgpt.cliExecutable'));
		assert.ok(extensionSource.includes('settings.json'));
	});
});
