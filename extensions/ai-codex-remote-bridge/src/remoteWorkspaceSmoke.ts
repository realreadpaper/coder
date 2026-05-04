/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as util from 'util';
import * as vscode from 'vscode';

const execFile = util.promisify(cp.execFile);

export interface RemoteWorkspaceSmokeResult {
	readonly workspaceRoot: string;
	readonly fsWriteRead: boolean;
	readonly execPwd: string;
	readonly terminalPwd: string;
	readonly gitStatus: string;
	readonly searchHit: boolean;
	readonly lspSymbols: string[];
	readonly reportPath: string;
}

export async function runRemoteWorkspaceSmoke(workspaceRoot: string): Promise<RemoteWorkspaceSmokeResult> {
	assertRemoteExtensionHost();
	const smokeDir = path.join(workspaceRoot, '.remote-ai-smoke');
	await fs.promises.mkdir(smokeDir, { recursive: true });

	const fsFile = path.join(smokeDir, 'fs-write-read.txt');
	const fsContent = `remote-ai-fs-${Date.now()}`;
	await fs.promises.writeFile(fsFile, fsContent, 'utf8');
	const fsWriteRead = await fs.promises.readFile(fsFile, 'utf8') === fsContent;

	const { stdout: pwdStdout } = await execFile('pwd', { cwd: workspaceRoot });
	const execPwd = pwdStdout.trim();
	const terminalPwd = await runTerminalPwdSmoke(workspaceRoot, path.join(smokeDir, 'terminal-pwd.txt'));

	const gitStatus = await commandStdout('git', ['status', '--short'], workspaceRoot);
	const searchHit = (await commandStdout('sh', ['-lc', 'if command -v rg >/dev/null 2>&1; then rg -n "hello remote-ai" .; else grep -R -n "hello remote-ai" .; fi'], workspaceRoot)).includes('hello remote-ai');
	const lspSymbols = await documentSymbols(path.join(workspaceRoot, 'index.ts'));
	const reportPath = path.join(smokeDir, 'workspace-smoke.json');
	const result: RemoteWorkspaceSmokeResult = {
		workspaceRoot,
		fsWriteRead,
		execPwd,
		terminalPwd,
		gitStatus,
		searchHit,
		lspSymbols,
		reportPath
	};
	await fs.promises.writeFile(reportPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
	return result;
}

export function assertRemoteExtensionHost(remoteName = vscode.env.remoteName): void {
	if (remoteName !== 'ssh-remote') {
		throw new Error('RemoteAI Codex bridge only runs inside an SSH remote workspace');
	}
}

async function runTerminalPwdSmoke(workspaceRoot: string, resultPath: string): Promise<string> {
	await fs.promises.rm(resultPath, { force: true });
	const terminal = vscode.window.createTerminal({
		name: 'RemoteAI Smoke',
		cwd: vscode.Uri.file(workspaceRoot),
		shellPath: fs.existsSync('/bin/bash') ? '/bin/bash' : undefined
	});
	try {
		terminal.sendText(`pwd > ${shellQuote(resultPath)}`);
		const deadline = Date.now() + 20_000;
		while (Date.now() < deadline) {
			try {
				return (await fs.promises.readFile(resultPath, 'utf8')).trim();
			} catch (error) {
				const code = (error as NodeJS.ErrnoException).code;
				if (code !== 'ENOENT') {
					throw error;
				}
			}
			await new Promise(resolve => setTimeout(resolve, 250));
		}
		throw new Error(`Timed out waiting for terminal smoke result: ${resultPath}`);
	} finally {
		terminal.dispose();
	}
}

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function commandStdout(command: string, args: string[], cwd: string): Promise<string> {
	try {
		const { stdout } = await execFile(command, args, { cwd });
		return stdout;
	} catch (error) {
		const execError = error as cp.ExecFileException & { stdout?: string; stderr?: string };
		return `${execError.stdout ?? ''}${execError.stderr ?? ''}`;
	}
}

async function documentSymbols(file: string): Promise<string[]> {
	const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
	await vscode.window.showTextDocument(document, { preview: false });
	const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>('vscode.executeDocumentSymbolProvider', document.uri);
	return (symbols ?? []).map(symbol => symbol.name);
}
