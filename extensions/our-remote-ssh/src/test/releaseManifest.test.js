/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('assert');
const path = require('path');
const { selectTarballFromManifest } = require('../../out/releaseManifest');

suite('RemoteAI release manifest', () => {
	test('selects tarball next to manifest', () => {
		const selected = selectTarballFromManifest('/tmp/remote-releases/dev-compat/manifest.json', {
			commit: 'dev-compat',
			platform: 'linux-x64',
			artifact: { name: 'vscode-reh-linux-x64.tar.gz', sha256: 'a'.repeat(64), size: 1 }
		});

		assert.strictEqual(selected.commit, 'dev-compat');
		assert.strictEqual(selected.sha256, 'a'.repeat(64));
		assert.strictEqual(selected.tarballPath, path.join('/tmp/remote-releases/dev-compat', 'vscode-reh-linux-x64.tar.gz'));
	});
});
