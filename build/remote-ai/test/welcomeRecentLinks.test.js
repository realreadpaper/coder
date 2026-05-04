/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('assert');
const fs = require('fs');
const path = require('path');

suite('Aura welcome recent links', () => {
	test('renders recent name and path inside one open button', () => {
		const source = fs.readFileSync(path.join(__dirname, '../../../src/vs/workbench/contrib/welcomeGettingStarted/browser/gettingStarted.ts'), 'utf8');
		const css = fs.readFileSync(path.join(__dirname, '../../../src/vs/workbench/contrib/welcomeGettingStarted/browser/media/gettingStarted.css'), 'utf8');

		assert.match(source, /\$\('button\.button-link\.recent-entry'\)/);
		assert.match(source, /\$\('span\.recent-name'/);
		assert.match(source, /\$\('span\.path\.detail'/);
		assert.doesNotMatch(source, /li\.appendChild\(span\);/);
		assert.match(css, /\.index-list\.recently-opened \.recent-entry/);
	});
});
