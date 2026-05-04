/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('assert');
const fs = require('fs');
const path = require('path');

suite('Remote Codex activation', () => {
	test('exposes local Codex CLI configuration for local file workspaces', () => {
		const pkg = require('../../package.json');
		const localCliPath = pkg.contributes.configuration.properties['remoteai.codex.localCliPath'];

		assert.strictEqual(localCliPath.type, 'string');
		assert.match(localCliPath.description, /local file workspaces/);
	});

	test('routes Codex tasks by explicit workspace target instead of remote fallback', () => {
		const extensionSource = fs.readFileSync(path.join(__dirname, '..', 'extension.ts'), 'utf8');

		assert.ok(extensionSource.includes('getCodexWorkspaceTarget()'));
		assert.ok(extensionSource.includes('target.kind === \'ssh\''));
		assert.ok(extensionSource.includes('target.kind === \'local\''));
		assert.ok(extensionSource.includes('runLocalWorkspaceTask('));
	});

	test('keeps SSH commands remote while rejecting unsupported remote authorities', () => {
		const extensionSource = fs.readFileSync(path.join(__dirname, '..', 'extension.ts'), 'utf8');
		const smokeSource = fs.readFileSync(path.join(__dirname, '..', 'remoteWorkspaceSmoke.ts'), 'utf8');

		assert.ok(extensionSource.includes('vscode.env.remoteName === \'ssh-remote\''));
		assert.ok(extensionSource.includes('!vscode.env.remoteName && folder.uri.scheme === \'file\''));
		assert.ok(extensionSource.includes('RemoteAI Codex bridge supports only local file workspaces or SSH remote workspaces'));
		assert.ok(extensionSource.includes('RemoteAI workspace smoke only runs inside an SSH remote workspace'));
		assert.ok(smokeSource.includes('assertRemoteExtensionHost();'));
	});
});
