/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { applyCodexAppendPatch } from './codexPatch';
import { runCodexWorkspaceTask } from './codexTaskRunner';
import { runRemoteCodexWorkspaceTask } from './remoteCodexRunner';
import { runRemoteWorkspaceSmoke } from './remoteWorkspaceSmoke';
import { WorkspaceSandbox } from './workspaceSandbox';

export function activate(context: vscode.ExtensionContext): void {
	const output = vscode.window.createOutputChannel('RemoteAI Codex Bridge');
	context.subscriptions.push(output);

	const inspectWorkspace = (): RemoteCodexWorkspaceInfo => {
		const folders = vscode.workspace.workspaceFolders ?? [];
		return {
			remoteName: vscode.env.remoteName,
			workspaceFolders: folders.map(folder => folder.uri.toString()),
			isRemote: Boolean(vscode.env.remoteName)
		};
	};

	context.subscriptions.push(vscode.commands.registerCommand('remoteai.codex.inspectWorkspace', inspectWorkspace));
	context.subscriptions.push(vscode.commands.registerCommand('remoteai.codex.assertWorkspacePath', async (candidate: string) => {
		const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		if (!root) {
			throw new Error('RemoteAI Codex bridge requires a workspace folder');
		}
		return new WorkspaceSandbox(root).assertInside(candidate);
	}));
	context.subscriptions.push(vscode.commands.registerCommand('remoteai.codex.runWorkspaceSmoke', async () => {
		const root = getWorkspaceRoot();
		output.appendLine(`Running RemoteAI workspace smoke in ${root}`);
		const result = await runRemoteWorkspaceSmoke(root);
		output.appendLine(`RemoteAI workspace smoke report: ${result.reportPath}`);
		return result;
	}));
	context.subscriptions.push(vscode.commands.registerCommand('remoteai.codex.applyApprovedPatch', async () => {
		const root = getWorkspaceRoot();
		output.appendLine(`Requesting Codex patch approval in ${root}`);
		const result = await applyCodexAppendPatch(root);
		output.appendLine(`Codex approved patch wrote ${result.bytesWritten} bytes to ${result.path}`);
		return result;
	}));
	context.subscriptions.push(vscode.commands.registerCommand('remoteai.codex.runTask', async (initialPrompt?: string) => {
		const folder = getWorkspaceFolder();
		const root = folder.uri.fsPath;
		const prompt = initialPrompt ?? await vscode.window.showInputBox({
			title: 'RemoteAI Codex: Run Task',
			prompt: 'Task for Codex to run in the remote workspace',
			placeHolder: 'Append a smoke line to README.md'
		});
		if (!prompt) {
			return undefined;
		}

		const configuration = vscode.workspace.getConfiguration('remoteai.codex');
		const sandboxMode = configuration.get<'read-only' | 'workspace-write' | 'danger-full-access'>('sandboxMode') || 'danger-full-access';
		const result = vscode.env.remoteName
			? await runRemoteWorkspaceTask(context, output, configuration, sandboxMode, root, prompt)
			: await runLocalWorkspaceTask(output, configuration.get<string>('localCliPath') || 'codex', sandboxMode, root, prompt);
		if (result.stdout) {
			output.appendLine(result.stdout);
		}
		if (result.stderr) {
			output.appendLine(result.stderr);
		}
		void vscode.window.showInformationMessage(`Remote Codex task finished. Last message: ${result.outputLastMessagePath ?? 'not written'}`);
		return result;
	}));
}

export function deactivate(): void { }

export interface RemoteCodexWorkspaceInfo {
	readonly remoteName: string | undefined;
	readonly workspaceFolders: string[];
	readonly isRemote: boolean;
}

function getWorkspaceRoot(): string {
	return getWorkspaceFolder().uri.fsPath;
}

function getWorkspaceFolder(): vscode.WorkspaceFolder {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		throw new Error('RemoteAI Codex bridge requires a workspace folder');
	}
	return folder;
}

async function runLocalWorkspaceTask(
	output: vscode.OutputChannel,
	codexPath: string,
	sandboxMode: 'read-only' | 'workspace-write' | 'danger-full-access',
	root: string,
	prompt: string
) {
	const reportDir = path.join(root, '.remote-ai-codex');
	await fs.promises.mkdir(reportDir, { recursive: true });
	const outputLastMessagePath = path.join(reportDir, 'last-message.md');
	output.appendLine(`Running local Codex task in ${root}`);
	output.appendLine(`Codex CLI: ${codexPath}`);
	return runCodexWorkspaceTask({
		codexPath,
		workspaceRoot: root,
		prompt,
		sandboxMode,
		outputLastMessagePath
	});
}

async function runRemoteWorkspaceTask(
	context: vscode.ExtensionContext,
	output: vscode.OutputChannel,
	configuration: vscode.WorkspaceConfiguration,
	sandboxMode: 'read-only' | 'workspace-write' | 'danger-full-access',
	root: string,
	prompt: string
) {
	const remoteCliPath = configuration.get<string>('remoteCliPath') || '';
	output.appendLine(`Running remote Codex task in ${root}`);
	output.appendLine(remoteCliPath ? `Remote Codex CLI: ${remoteCliPath}` : 'Remote Codex CLI: managed Linux install path');
	return runRemoteCodexWorkspaceTask({
		remoteCliPath,
		globalStoragePath: context.globalStorageUri.fsPath,
		workspaceRoot: root,
		prompt,
		sandboxMode
	});
}
