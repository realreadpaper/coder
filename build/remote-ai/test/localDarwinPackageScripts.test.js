/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('assert');
const fs = require('fs');
const path = require('path');

suite('Aura local macOS package scripts', () => {
	test('ad-hoc signs the local app and verifies it strictly', () => {
		const script = fs.readFileSync(path.join(__dirname, '../../../scripts/remote-ai-sign-darwin-local.sh'), 'utf8');

		assert.match(script, /codesign\s+--force\s+--deep\s+--sign\s+-/);
		assert.match(script, /codesign\s+--verify\s+--deep\s+--strict\s+--verbose=4/);
		assert.match(script, /xattr\s+-dr\s+com\.apple\.quarantine/);
		assert.match(script, /xattr\s+-dr\s+com\.apple\.provenance/);
	});

	test('creates a fast local signed dmg without rebuilding vscode-darwin', () => {
		const script = fs.readFileSync(path.join(__dirname, '../../../scripts/remote-ai-package-local-dmg.sh'), 'utf8');

		assert.match(script, /remote-ai-sign-darwin-local\.sh/);
		assert.match(script, /tsc\s+-p\s+extensions\/our-remote-ssh\/tsconfig\.json/);
		assert.match(script, /APP_EXTENSIONS_DIR/);
		assert.match(script, /extensions\/our-remote-ssh/);
		assert.match(script, /APP_NODE_MODULES_DIR/);
		assert.match(script, /@vscode\/vsce-sign/);
		assert.match(script, /@vscode\/vsce-sign-\$VSCODE_PLATFORM_ARCH/);
		assert.match(script, /@vscode\/vsce-sign\/src\/postinstall\.js/);
		assert.match(script, /DMG_STAGING_DIR/);
		assert.match(script, /ln\s+-s\s+\/Applications\s+"\$DMG_STAGING_DIR\/Applications"/);
		assert.match(script, /ditto\s+"\$APP_PATH"\s+"\$DMG_STAGING_DIR\/\$APP_NAME"/);
		assert.match(script, /hdiutil\s+create/);
		assert.match(script, /-srcfolder\s+"\$DMG_STAGING_DIR"/);
		assert.match(script, /Aura-darwin-\$VSCODE_ARCH-local-signed\.dmg/);
		assert.match(script, /shasum\s+-a\s+256/);
		assert.doesNotMatch(script, /vscode-darwin-\$VSCODE_ARCH-min/);
		assert.doesNotMatch(script, /npm run gulp/);
	});
});
