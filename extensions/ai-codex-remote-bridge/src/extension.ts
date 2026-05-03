/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as os from 'os';
import * as vscode from 'vscode';
import { applyCodexAppendPatch } from './codexPatch';
import { createCodexCliInstallPlan } from './codexCliInstaller';
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
	context.subscriptions.push(vscode.commands.registerCommand('remoteai.codex.prepareRemoteCli', async () => {
		const configured = vscode.workspace.getConfiguration('remoteai.codex').get<string>('remoteCliPath');
		if (configured) {
			output.appendLine(`Using configured remote Codex CLI: ${configured}`);
			return { binPath: configured, configured: true };
		}

		const plan = createCodexCliInstallPlan(context.globalStorageUri.fsPath, os.platform(), os.arch());
		await fs.promises.mkdir(plan.installRoot, { recursive: true });
		output.appendLine(`Remote Codex CLI package selected: ${plan.packageName}`);
		output.appendLine(`Expected remote Codex CLI path: ${plan.binPath}`);
		return { ...plan, configured: false };
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
}

export function deactivate(): void { }

export interface RemoteCodexWorkspaceInfo {
	readonly remoteName: string | undefined;
	readonly workspaceFolders: string[];
	readonly isRemote: boolean;
}

function getWorkspaceRoot(): string {
	const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	if (!root) {
		throw new Error('RemoteAI Codex bridge requires a workspace folder');
	}
	return root;
}
