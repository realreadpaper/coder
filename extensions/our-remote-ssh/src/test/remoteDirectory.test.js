/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('assert');
const { createListDirectoryScript, joinRemotePath, parentRemotePath, parseRemoteDirectoryListing } = require('../../out/remoteDirectory');

suite('RemoteAI remote directory picker', () => {
	test('creates a quoted POSIX directory listing script', () => {
		const script = createListDirectoryScript('/home/dev/it\'s here');

		assert.match(script, /cd "\$target"/);
		assert.match(script, /__REMOTE_AI_PWD__/);
		assert.match(script, /'\/home\/dev\/it'\\''s here'/);
	});

	test('expands home paths after safe shell quoting', () => {
		const script = createListDirectoryScript('~/project');

		assert.match(script, /target='~\/project'/);
		assert.match(script, /target=\$HOME\/\$\{target#'~\/'\}/);
	});

	test('parses current directory marker and child directories', () => {
		const listing = parseRemoteDirectoryListing('__REMOTE_AI_PWD__/home/dev/project\nsrc\n.git\n\n');

		assert.strictEqual(listing.path, '/home/dev/project');
		assert.deepStrictEqual(listing.directories, ['src', '.git']);
	});

	test('joins and moves to parent paths', () => {
		assert.strictEqual(joinRemotePath('/home/dev', 'project'), '/home/dev/project');
		assert.strictEqual(joinRemotePath('/', 'tmp'), '/tmp');
		assert.strictEqual(parentRemotePath('/home/dev/project'), '/home/dev');
		assert.strictEqual(parentRemotePath('/'), '/');
	});
});
