/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('assert');
const { isSameRemoteWorkspace, normalizeRemotePath } = require('../../out/workspaceTarget');

suite('RemoteAI SSH workspace target', () => {
	test('normalizes remote paths for vscode-remote URIs', () => {
		assert.strictEqual(normalizeRemotePath('~'), '/');
		assert.strictEqual(normalizeRemotePath('/home/hejianglong/project'), '/home/hejianglong/project');
		assert.strictEqual(normalizeRemotePath('home/hejianglong/project'), '/home/hejianglong/project');
	});

	test('detects when current workspace already matches selected ssh target', () => {
		const currentWorkspaceFolders = [{
			uri: {
				scheme: 'vscode-remote',
				authority: 'ssh-remote+dev',
				path: '/home/hejianglong/remote-ai-manual'
			}
		}];

		assert.strictEqual(isSameRemoteWorkspace(currentWorkspaceFolders, 'dev', '/home/hejianglong/remote-ai-manual'), true);
		assert.strictEqual(isSameRemoteWorkspace(currentWorkspaceFolders, 'dev', '/home/hejianglong/other'), false);
		assert.strictEqual(isSameRemoteWorkspace(currentWorkspaceFolders, 'prod', '/home/hejianglong/remote-ai-manual'), false);
	});

	test('detects current workspace when the ssh separator is URI encoded', () => {
		const currentWorkspaceFolders = [{
			uri: {
				scheme: 'vscode-remote',
				authority: 'ssh-remote%2Bdev',
				path: '/home/hejianglong'
			}
		}];

		assert.strictEqual(isSameRemoteWorkspace(currentWorkspaceFolders, 'dev', '/home/hejianglong'), true);
	});
});
