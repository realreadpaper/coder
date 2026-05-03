/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const { _electron } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../..');

const forbiddenPatterns = [
	/\bChat:/i,
	/\bInline Chat\b/i,
	/\bNew Chat\b/i,
	/\bOpen Chat\b/i,
	/\bQuick Chat\b/i,
	/\bChat Editor\b/i
];

async function main() {
	const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-ai-chat-disabled-user-'));
	const logsPath = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-ai-chat-disabled-logs-'));
	const localWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-ai-chat-disabled-workspace-'));

	const app = await _electron.launch({
		executablePath: electronPath(),
		args: [
			ROOT,
			localWorkspace,
			'--skip-release-notes',
			'--skip-welcome',
			'--disable-workspace-trust',
			'--disable-telemetry',
			'--disable-updates',
			'--no-cached-data',
			`--user-data-dir=${userDataDir}`,
			`--logsPath=${logsPath}`,
			...extensionArgs(),
			'--enable-smoke-test-driver'
		],
		env: { ...process.env, NODE_ENV: 'development', VSCODE_DEV: '1', ELECTRON_ENABLE_LOGGING: '1' }
	});

	try {
		const page = await app.firstWindow();
		await page.waitForSelector('.monaco-workbench', { timeout: 60_000 });

		const results = {};
		for (const query of ['Chat', 'Inline Chat', 'New Chat', 'Chat:']) {
			results[query] = await commandPaletteRows(page, query);
		}

		const forbiddenRows = Object.entries(results).flatMap(([query, rows]) => rows
			.filter(row => forbiddenPatterns.some(pattern => pattern.test(row)))
			.map(row => ({ query, row }))
		);

		if (forbiddenRows.length) {
			throw new Error(`Chat UI command palette entries are still visible:\n${JSON.stringify(forbiddenRows, null, 2)}`);
		}

		console.log(JSON.stringify({ status: 'passed', results }, null, 2));
	} finally {
		await app.close();
	}
}

async function commandPaletteRows(page, query) {
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+P' : 'Control+Shift+P');
	await page.waitForSelector('.quick-input-widget', { timeout: 15_000 });
	await page.locator('.quick-input-widget input').fill(query);
	await page.waitForTimeout(1000);
	const rows = await page.locator('.quick-input-list .monaco-list-row').allInnerTexts();
	await page.keyboard.press('Escape');
	await page.locator('.quick-input-widget').waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => undefined);
	return rows.map(row => row.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

function electronPath() {
	if (process.platform === 'darwin') {
		return path.join(ROOT, '.build/electron/Code - OSS.app/Contents/MacOS/Electron');
	}
	if (process.platform === 'linux') {
		return path.join(ROOT, '.build/electron/code-oss');
	}
	throw new Error(`Unsupported E2E platform: ${process.platform}`);
}

function extensionArgs() {
	const extensionsDir = process.env.REMOTE_AI_TEST_EXTENSIONS_DIR;
	return extensionsDir ? [`--extensions-dir=${extensionsDir}`] : [];
}

main().catch(error => {
	console.error(error && error.stack || error);
	process.exitCode = 1;
});
