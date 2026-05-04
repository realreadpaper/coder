/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('assert');
const product = require('../../../product.json');

suite('RemoteAI product configuration', () => {
	test('declares remote server identity and download template', () => {
		assert.strictEqual(product.serverApplicationName, 'remote-ai-server');
		assert.strictEqual(product.serverDataFolderName, '.remote-ai-server');
		assert.match(product.serverDownloadUrlTemplate, /remote-releases\/\$\{commit\}\/vscode-reh-\$\{os\}-\$\{arch\}\.tar\.gz/);
	});

	test('declares an extension gallery for plugin search and install', () => {
		assert.strictEqual(product.extensionsGallery.serviceUrl, 'https://marketplace.visualstudio.com/_apis/public/gallery');
		assert.strictEqual(product.extensionsGallery.itemUrl, 'https://marketplace.visualstudio.com/items');
		assert.strictEqual(product.extensionsGallery.resourceUrlTemplate, 'https://{publisher}.gallerycdn.vsassets.io/extensions/{publisher}/{name}/{version}/{path}');
	});

	test('authorizes required proposed APIs', () => {
		assert.deepStrictEqual([...product.extensionEnabledApiProposals['our.remote-ssh']].sort(), [
			'contribRemoteHelp',
			'contribViewsRemote',
			'resolvers',
			'tunnels'
		].sort());
		assert.deepStrictEqual([...product.extensionEnabledApiProposals['openai.chatgpt']].sort(), [
			'chatSessionsProvider',
			'contribSecondarySidebar',
			'languageModelProxy'
		].sort());
	});

	test('runs Codex bridge in the workspace extension host', () => {
		assert.deepStrictEqual(product.extensionKind['openai.chatgpt'], ['ui']);
		assert.deepStrictEqual(product.extensionKind['our.ai-codex-remote-bridge'], ['workspace']);
		assert.strictEqual(product.extensionKindOverrides, undefined);
	});

	test('declares audit configuration', () => {
		assert.strictEqual(product.remoteAiAudit.enabled, true);
		assert.strictEqual(product.remoteAiAudit.fileName, 'remote-ai-audit.jsonl');
		assert.strictEqual(product.remoteAiAudit.includeHashChain, true);
	});

	test('allows RemoteAI proven ABI compatibility path', () => {
		assert.strictEqual(product.remoteAiAllowUnsupportedGlibc, true);
	});
});
