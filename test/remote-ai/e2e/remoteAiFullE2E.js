/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const { _electron } = require('@playwright/test');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../..');
const product = require(path.join(ROOT, 'product.json'));
const HOST = process.env.REMOTE_AI_TEST_SSH || 'dev';
const REMOTE_ROOT = process.env.REMOTE_AI_TEST_WORKSPACE || '/home/hejianglong/remote-ai-e2e';
const COMMIT = process.env.REMOTE_AI_TEST_COMMIT || 'dev-compat';
const TARBALL = process.env.REMOTE_AI_TEST_TARBALL || path.join(ROOT, 'remote-releases/dev-compat/vscode-reh-linux-x64.tar.gz');
const CODEX_E2E_MARKER = `RemoteAI remote Codex E2E edit ${Date.now()}`;

async function main() {
	assertNoLocalMirrorCodexPath(ROOT);
	prepareRemoteFixture();
	const remoteCodexCli = prepareRemoteCodexCli();

	const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-ai-e2e-user-'));
	const logsPath = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-ai-e2e-logs-'));
	const localWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-ai-e2e-local-'));
	writeSettings(userDataDir, remoteCodexCli);

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
			'--enable-smoke-test-driver'
		],
		env: { ...process.env, NODE_ENV: 'development', VSCODE_DEV: '1', ELECTRON_ENABLE_LOGGING: '1' }
	});

	try {
		const page = await app.firstWindow();
		await page.waitForSelector('.monaco-workbench', { timeout: 60_000 });
		await openDashboardAndConnect(page);
		await acceptUnsupportedOsDialogIfShown(page);
		await page.locator('text=README.md').waitFor({ timeout: 120_000 });
		await page.screenshot({ path: path.join(logsPath, '01-remote-workspace.png'), fullPage: true });

		await runCodexTask(page, `Append exactly this line to README.md and do not modify other files: ${CODEX_E2E_MARKER}`);
		await waitForRemoteDiff(CODEX_E2E_MARKER);
		await page.screenshot({ path: path.join(logsPath, '02-local-codex-remote-edit.png'), fullPage: true });

		console.log(JSON.stringify({
			status: 'passed',
			host: HOST,
			remoteRoot: REMOTE_ROOT,
			logsPath,
			remoteCodexCli,
			codexMarker: CODEX_E2E_MARKER
		}, null, 2));
	} finally {
		await app.close();
	}
}

function prepareRemoteFixture() {
	ssh(`rm -rf ${shellQuote(REMOTE_ROOT)} && mkdir -p ${shellQuote(REMOTE_ROOT)} && cd ${shellQuote(REMOTE_ROOT)} && git init -q && printf 'hello remote-ai\\n' > README.md && printf 'export const value = 1;\\nexport function smokeSymbol() { return value; }\\n' > index.ts && git add README.md index.ts && git -c user.name='RemoteAI E2E' -c user.email='remoteai@example.invalid' commit -qm 'initial remote fixture'`);
	ssh(`rm -rf ${shellQuote(`/home/hejianglong/.remote-ai-server/bin/${COMMIT}`)}`);
}

function prepareRemoteCodexCli() {
	if (process.env.REMOTE_AI_TEST_REMOTE_CODEX_CLI) {
		return process.env.REMOTE_AI_TEST_REMOTE_CODEX_CLI;
	}
	const output = cp.execFileSync('bash', ['scripts/remote-ai-prepare-codex.sh'], {
		cwd: ROOT,
		encoding: 'utf8',
		env: {
			...process.env,
			REMOTE_AI_CODEX_HOST: HOST
		}
	}).trim();
	const remotePath = output.split(/\r?\n/).filter(Boolean).at(-1);
	if (!remotePath) {
		throw new Error(`Remote Codex preparation did not return a path:\n${output}`);
	}
	return remotePath;
}

function writeSettings(userDataDir, remoteCodexCli) {
	fs.mkdirSync(path.join(userDataDir, 'User'), { recursive: true });
	fs.writeFileSync(path.join(userDataDir, 'User', 'settings.json'), `${JSON.stringify({
		'remoteai.ssh.serverManifestPath': path.join(ROOT, 'remote-releases/dev-compat/manifest.json'),
		'remoteai.ssh.serverTarballPath': TARBALL,
		'remoteai.ssh.commit': COMMIT,
		'remoteai.ssh.defaultRemotePath': REMOTE_ROOT,
		'remoteai.ssh.sshPath': 'ssh',
		'remoteai.codex.remoteCliPath': remoteCodexCli,
		'remoteai.codex.sandboxMode': 'danger-full-access',
		'terminal.integrated.defaultProfile.linux': 'bash',
		'terminal.integrated.profiles.linux': {
			bash: {
				path: '/bin/bash'
			}
		}
	}, null, 2)}\n`);
}

async function runCodexTask(page, prompt) {
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+P' : 'Control+Shift+P');
	await page.waitForSelector('.quick-input-widget', { timeout: 15_000 });
	await page.keyboard.type('RemoteAI: Run Codex Task in Remote Workspace');
	await page.locator('.quick-input-list .monaco-list-row').filter({ hasText: /Run Codex Task in Remote Workspace/ }).first().waitFor({ timeout: 30_000 });
	await page.keyboard.press('Enter');
	await page.locator('.quick-input-widget input').waitFor({ timeout: 15_000 });
	await page.locator('.quick-input-widget input').fill(prompt);
	await page.keyboard.press('Enter');
	await page.locator('.quick-input-widget').waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => undefined);
}

async function openDashboardAndConnect(page) {
	await runCommand(page, 'RemoteAI: Open SSH Dashboard');
	const frame = await dashboardFrame(page);
	await frame.locator('input[name="host"]').fill(HOST);
	await frame.locator('input[name="remotePath"]').fill(REMOTE_ROOT);
	await frame.locator('[data-command="browseRemoteFolder"]').click();
	await page.locator('.quick-input-widget').waitFor({ timeout: 30_000 });
	await page.locator('.quick-input-list .monaco-list-row').filter({ hasText: /Select this folder/ }).first().waitFor({ timeout: 30_000 });
	await page.keyboard.press('Enter');
	await page.locator('.quick-input-widget').waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => undefined);
	await frame.locator('input[name="remotePath"]').inputValue({ timeout: 15_000 }).then(value => {
		if (value !== REMOTE_ROOT) {
			throw new Error(`Remote folder picker selected ${value}, expected ${REMOTE_ROOT}`);
		}
	});
	await frame.locator('[data-command="connect"]').click();
}

async function dashboardFrame(page) {
	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline) {
		const frame = page.frames().find(candidate => candidate.url().includes('/fake.html'));
		if (frame) {
			await frame.locator('input[name="host"]').waitFor({ timeout: 5_000 });
			return frame;
		}
		await page.waitForTimeout(250);
	}
	throw new Error('RemoteAI dashboard frame not found');
}

async function runCommand(page, command) {
	await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+P' : 'Control+Shift+P');
	await page.waitForSelector('.quick-input-widget', { timeout: 15_000 });
	await page.keyboard.type(command);
	const title = command.includes(': ') ? command.slice(command.indexOf(': ') + 2) : command;
	await page.locator('.quick-input-list .monaco-list-row').filter({ hasText: new RegExp(escapeRegExp(title)) }).first().waitFor({ timeout: 30_000 });
	await page.keyboard.press('Enter');
	await page.locator('.quick-input-widget').waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => undefined);
}

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function acceptUnsupportedOsDialogIfShown(page) {
	try {
		await page.locator('text=unsupported by').waitFor({ timeout: 10_000 });
		const allow = page.getByText('Allow', { exact: true }).last();
		const box = await allow.boundingBox();
		if (!box) {
			throw new Error('Allow button is not visible');
		}
		await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
		await page.locator('text=unsupported by').waitFor({ state: 'hidden', timeout: 10_000 });
	} catch {
		// Newer compatibility builds may not show this VS Code core warning.
	}
}

async function waitRemoteFile(file, timeoutMs) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			ssh(`test -f ${shellQuote(file)}`);
			return;
		} catch {
			await new Promise(resolve => setTimeout(resolve, 1000));
		}
	}
	throw new Error(`Timed out waiting for remote file ${file}`);
}

function assertNoLocalMirrorCodexPath(repoRoot) {
	const bridgeSrc = path.join(repoRoot, 'extensions/ai-codex-remote-bridge/src');
	const result = cp.spawnSync('rg', [
		'-n',
		[
			'localRemoteCodex' + 'Runner',
			'runLocalCodexRemote' + 'WorkspaceTask',
			'local-' + 'remote-workspaces',
			'buildRsyncPullArgs',
			'buildRsyncPushArgs'
		].join('|'),
		bridgeSrc
	], { encoding: 'utf8' });
	if (result.status === 0) {
		throw new Error(`Codex local mirror path still exists:\n${result.stdout}`);
	}
	if (result.status !== 1) {
		throw new Error(`rg failed while checking Codex mirror removal:\n${result.stderr}`);
	}
}

async function waitForRemoteDiff(marker) {
	const deadline = Date.now() + 240_000;
	while (Date.now() < deadline) {
		const diff = ssh(`cd ${shellQuote(REMOTE_ROOT)} && git diff -- README.md`);
		if (diff.includes(marker)) {
			return;
		}
		await new Promise(resolve => setTimeout(resolve, 1000));
	}
	throw new Error(`Timed out waiting for remote Codex edit in remote git diff: ${marker}`);
}

function electronPath() {
	if (process.platform === 'darwin') {
		return path.join(ROOT, `.build/electron/${product.nameLong}.app/Contents/MacOS/Electron`);
	}
	if (process.platform === 'linux') {
		return path.join(ROOT, `.build/electron/${product.applicationName}`);
	}
	throw new Error(`Unsupported E2E platform: ${process.platform}`);
}

function ssh(script) {
	return cp.execFileSync('ssh', ['-T', HOST, script], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function shellQuote(value) {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

main().catch(error => {
	console.error(error && error.stack || error);
	process.exitCode = 1;
});
