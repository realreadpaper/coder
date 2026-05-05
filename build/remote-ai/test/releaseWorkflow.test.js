/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('assert');
const fs = require('fs');
const path = require('path');

suite('Aura release workflow', () => {
	test('publishes installers for all desktop platforms on release', () => {
		const workflow = fs.readFileSync(path.join(__dirname, '../../../.github/workflows/remote-ai-release.yml'), 'utf8');

		assert.match(workflow, /name: Aura Release/);
		assert.match(workflow, /release:\n\s+types:\n\s+- published/);
		assert.match(workflow, /default: 'v0\.1'/);
		assert.match(workflow, /Aura-\$\{release_tag\}-darwin-\$\{\{ matrix\.arch \}\}-unsigned\.dmg/);
		assert.match(workflow, /Aura-\$\{release_tag\}-linux-x64\.tar\.gz/);
		assert.match(workflow, /Aura-\$\{release_tag\}-win32-x64-user-setup\.exe/);
		assert.match(workflow, /Aura-\$\{release_tag\}-darwin-\$\{\{ matrix\.arch \}\}-SHA256SUMS\.txt/);
		assert.match(workflow, /Aura-\$\{release_tag\}-linux-x64-SHA256SUMS\.txt/);
		assert.match(workflow, /Aura-\$\{release_tag\}-win32-x64-SHA256SUMS\.txt/);
		assert.match(workflow, /gh release upload/);
	});

	test('bundles remote server and Aura runtime into client packages', () => {
		const workflow = fs.readFileSync(path.join(__dirname, '../../../.github/workflows/remote-ai-release.yml'), 'utf8');

		assert.match(workflow, /Aura-\$\{release_tag\}-remote-server-linux-x64\.tar\.gz/);
		assert.match(workflow, /tar -xzf dist\/remote-ai-release\/server\/Aura-\*-remote-server-linux-x64\.tar\.gz/);
		assert.match(workflow, /cp -R dist\/remote-ai-release\/remote-releases/);
		assert.match(workflow, /cp -R resources\/aura-code/);
	});
});
