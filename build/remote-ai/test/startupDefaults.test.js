/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('assert');
const fs = require('fs');
const path = require('path');

suite('Aura startup defaults', () => {
	test('opens the welcome startup page instead of restoring stale windows by default', () => {
		const desktopContribution = fs.readFileSync(path.join(__dirname, '../../../src/vs/workbench/electron-browser/desktop.contribution.ts'), 'utf8');
		const gettingStartedContribution = fs.readFileSync(path.join(__dirname, '../../../src/vs/workbench/contrib/welcomeGettingStarted/browser/gettingStarted.contribution.ts'), 'utf8');

		assert.match(desktopContribution, /'window\.restoreWindows':[\s\S]*?'default': 'none'/);
		assert.match(gettingStartedContribution, /'workbench\.startupEditor':[\s\S]*?'default': 'welcomePage'/);
	});
});
