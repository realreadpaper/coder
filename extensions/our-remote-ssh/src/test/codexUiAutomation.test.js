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

	test('installs a pending Codex wrapper before opening the SSH workspace', () => {
		const extensionSource = fs.readFileSync(path.join(__dirname, '..', 'extension.ts'), 'utf8');
		const configureIndex = extensionSource.indexOf('await configurePendingCodexUiForSshTarget(context, output, auditLog, codexRuntimeStatus, host, remotePath);');
		const openIndex = extensionSource.indexOf('await openRemoteFolder(host, remotePath);');
		const activateIndex = extensionSource.indexOf('void configureCodexUiForSshTarget(context, output, auditLog, codexRuntimeStatus, host, remotePath)');

		assert.ok(configureIndex > -1);
		assert.ok(openIndex > -1);
		assert.ok(activateIndex > -1);
		assert.ok(configureIndex < openIndex);
		assert.ok(openIndex < activateIndex);
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
		const writeWrapperIndex = extensionSource.indexOf('await writeCodexWrapper(activePlan.wrapperPath, activePlan.script', failureIndex);

		assert.ok(failureIndex > -1);
		assert.ok(unavailableIndex > -1);
		assert.ok(writeWrapperIndex > -1);
		assert.ok(failureIndex < unavailableIndex);
		assert.ok(unavailableIndex < writeWrapperIndex);
	});

	test('records runtime setup as diagnosable state machine stages', () => {
		const extensionSource = fs.readFileSync(path.join(__dirname, '..', 'extension.ts'), 'utf8');

		assert.ok(extensionSource.includes('new CodexRuntimeStateMachine'));
		for (const stage of ['probe', 'select', 'fetch', 'install', 'verify', 'syncCredentials', 'bind']) {
			assert.ok(extensionSource.includes(`runStage('${stage}'`), `missing runtime stage ${stage}`);
		}
		assert.ok(extensionSource.includes('createCodexRuntimeMarkerPath'));
		assert.ok(extensionSource.includes('aura.runtime.stage'));
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

	test('pushes latest local Codex credentials and config on SSH activation by default', () => {
		const pkg = require('../../package.json');
		const extensionSource = fs.readFileSync(path.join(__dirname, '..', 'extension.ts'), 'utf8');

		assert.strictEqual(pkg.contributes.configuration.properties['remoteai.codex.credentialsOverwrite'].default, true);
		assert.ok(extensionSource.includes('codexConfiguration.get<boolean>(\'credentialsOverwrite\') ?? true'));
	});

	test('keeps shared Codex CLI settings declared by Aura SSH only', () => {
		const pkg = require('../../package.json');
		const bridgePkg = require('../../../ai-codex-remote-bridge/package.json');

		assert.ok(pkg.contributes.configuration.properties['remoteai.codex.remoteCliPath']);
		assert.ok(pkg.contributes.configuration.properties['remoteai.codex.sandboxMode']);
		assert.ok(!bridgePkg.contributes.configuration.properties['remoteai.codex.remoteCliPath']);
		assert.ok(!bridgePkg.contributes.configuration.properties['remoteai.codex.sandboxMode']);
	});

	test('keeps dangerous Codex bypass opt-in', () => {
		const pkg = require('../../package.json');
		const extensionSource = fs.readFileSync(path.join(__dirname, '..', 'extension.ts'), 'utf8');

		assert.strictEqual(pkg.contributes.configuration.properties['remoteai.codex.bypassApprovalsAndSandbox'].default, false);
		assert.ok(extensionSource.includes('codexConfiguration.get<boolean>(\'bypassApprovalsAndSandbox\') ?? false'));
	});
});
