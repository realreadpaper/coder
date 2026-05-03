/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { AuditLogWriter } from './auditLog';
import { toSshRemoteAuthority } from './authority';
import { ConnectionHistoryEntry, updateConnectionHistory } from './connectionHistory';
import { createDiagnosticsReport, DiagnosticsManifestStatus } from './diagnostics';
import { renderDashboardHtml } from './dashboardRenderer';
import { parseRemoteAiError } from './logParser';
import { createListDirectoryScript, joinRemotePath, parentRemotePath, parseRemoteDirectoryListing } from './remoteDirectory';
import { selectTarballFromManifest, RemoteAiReleaseManifest } from './releaseManifest';
import { resolveSshRemoteAuthority, ResolvedSshRemote } from './resolver';
import { parseSshConfig } from './sshConfig';
import { sshExec } from './sshProcess';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext): void {
	const output = vscode.window.createOutputChannel('RemoteAI SSH');
	context.subscriptions.push(output);
	const activeConnections = new Set<ResolvedSshRemote>();

	const auditLog = new AuditLogWriter(vscode.Uri.joinPath(context.globalStorageUri, 'remote-ai-audit.jsonl').fsPath, {
		sessionId: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
		actor: 'our.remote-ssh'
	});

	void auditLog.record({
		operation: 'extension.activate',
		status: 'succeeded',
		metadata: { extension: 'our.remote-ssh' }
	});

	const openRemoteFolder = async (host: string, remotePath: string) => {
		const authority = toSshRemoteAuthority(host);
		await auditLog.record({
			operation: 'remote.openFolder.request',
			status: 'started',
			authority,
			workspaceRoot: remotePath
		});
		await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.from({
			scheme: 'vscode-remote',
			authority,
			path: normalizeRemotePath(remotePath)
		}), false);
	};

	const connectCommand = async () => {
		const host = await vscode.window.showInputBox({
			title: 'RemoteAI SSH: Connect to Host',
			prompt: 'Step 1: SSH host',
			placeHolder: 'dev'
		});
		if (!host) {
			return;
		}

		const configuredPath = getSshConfiguration().get<string>('defaultRemotePath') || '~';
		const remotePath = await pickRemoteFolder(host.trim(), configuredPath);
		if (!remotePath) {
			return;
		}

		await openRemoteFolder(host.trim(), remotePath);
	};

	context.subscriptions.push(vscode.commands.registerCommand('opensshremotes.openEmptyWindowInCurrentWindow', connectCommand));
	context.subscriptions.push(vscode.commands.registerCommand('remoteai.ssh.connectToHost', connectCommand));
	context.subscriptions.push(vscode.commands.registerCommand('remoteai.ssh.openDashboard', () => {
		openDashboard(context, auditLog, openRemoteFolder);
	}));
	context.subscriptions.push(vscode.commands.registerCommand('remoteai.ssh.showDiagnostics', async () => {
		await showDiagnostics(context);
	}));

	context.subscriptions.push(vscode.workspace.registerRemoteAuthorityResolver('ssh-remote', {
		async resolve(authority: string): Promise<vscode.ResolverResult> {
			const configuration = getSshConfiguration();
			const release = await resolveConfiguredServerRelease(configuration);
			const commit = release.commit || vscode.env.appCommit || 'dev';
			const serverTarballPath = release.tarballPath;
			const sshPath = configuration.get<string>('sshPath') || 'ssh';
			const connectionToken = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
			output.appendLine(`Resolving ${authority} with commit ${commit}`);
			await auditLog.record({
				operation: 'remoteAuthority.resolve',
				status: 'started',
				authority,
				metadata: { commit, hasServerTarballPath: Boolean(serverTarballPath), sshPath }
			});

			try {
				const resolved = await resolveSshRemoteAuthority(authority, {
					commit,
					connectionToken,
					localTarballPath: serverTarballPath,
					sha256: release.sha256,
					sshPath,
					auditLog
				});
				activeConnections.add(resolved);
				context.subscriptions.push({
					dispose: () => {
						resolved.dispose();
						activeConnections.delete(resolved);
					}
				});

				await auditLog.record({
					operation: 'remoteAuthority.resolve',
					status: 'succeeded',
					authority,
					metadata: { commit, localPort: resolved.authority.port, serverDir: resolved.install.serverDir }
				});
				return new vscode.ResolvedAuthority(resolved.authority.host, resolved.authority.port, resolved.authority.connectionToken);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				const marker = parseRemoteAiError(message);
				output.appendLine(marker ? `${marker.code}: ${marker.detail}` : message);
				await auditLog.record({
					operation: 'remoteAuthority.resolve',
					status: 'failed',
					authority,
					metadata: { commit, error: message }
				});
				throw vscode.RemoteAuthorityResolverError.NotAvailable(message, true);
			}
		}
	}));

	context.subscriptions.push({
		dispose: () => {
			for (const connection of activeConnections) {
				connection.dispose();
			}
			activeConnections.clear();
		}
	});
}

export function deactivate(): void { }

function getSshConfiguration(): vscode.WorkspaceConfiguration {
	return vscode.workspace.getConfiguration('remoteai.ssh');
}

function openDashboard(
	context: vscode.ExtensionContext,
	auditLog: AuditLogWriter,
	openRemoteFolder: (host: string, remotePath: string) => Promise<void>
): void {
	const panel = vscode.window.createWebviewPanel(
		'remoteAiSshDashboard',
		'RemoteAI SSH',
		vscode.ViewColumn.One,
		{ enableScripts: true }
	);
	const configuration = getSshConfiguration();
	const nonce = createNonce();
	const initialHost = 'dev';
	const initialRemotePath = configuration.get<string>('defaultRemotePath') || '~';
	const serverTarballPath = configuration.get<string>('serverTarballPath') || '';
	const commit = configuration.get<string>('commit') || vscode.env.appCommit || 'dev';
	const sshPath = configuration.get<string>('sshPath') || 'ssh';
	const auditPath = vscode.Uri.joinPath(context.globalStorageUri, 'remote-ai-audit.jsonl').fsPath;

	panel.webview.html = renderDashboardHtml({
		nonce,
		initialHost,
		initialRemotePath,
		serverTarballPath,
		commit,
		sshPath,
		auditPath,
		hostOptions: readSshHostOptions(),
		recentConnections: context.globalState.get<ConnectionHistoryEntry[]>('remoteai.ssh.connectionHistory') ?? []
	});

	panel.webview.onDidReceiveMessage(async message => {
		if (message?.type === 'connect') {
			const host = String(message.host || '').trim();
			const remotePath = String(message.remotePath || '').trim();
			if (!host || !remotePath) {
				await panel.webview.postMessage({ type: 'status', status: 'Ready', message: 'Host and remote folder are required.' });
				return;
			}
			await auditLog.record({
				operation: 'dashboard.connect.request',
				status: 'started',
				authority: toSshRemoteAuthority(host),
				workspaceRoot: remotePath
			});
			await context.globalState.update('remoteai.ssh.connectionHistory', updateConnectionHistory(
				context.globalState.get<ConnectionHistoryEntry[]>('remoteai.ssh.connectionHistory') ?? [],
				{ host, remotePath, lastUsed: new Date().toISOString() }
			));
			await panel.webview.postMessage({ type: 'status', status: 'Connecting', message: `${host}:${remotePath}` });
			try {
				await openRemoteFolder(host, remotePath);
			} catch (error) {
				const text = error instanceof Error ? error.message : String(error);
				await auditLog.record({
					operation: 'dashboard.connect.request',
					status: 'failed',
					authority: toSshRemoteAuthority(host),
					workspaceRoot: remotePath,
					metadata: { error: text }
				});
				await panel.webview.postMessage({ type: 'status', status: 'Ready', message: text });
			}
		}
		if (message?.type === 'browseRemoteFolder') {
			const host = String(message.host || '').trim();
			const startPath = String(message.remotePath || initialRemotePath).trim() || initialRemotePath;
			if (!host) {
				await panel.webview.postMessage({ type: 'status', status: 'Ready', message: 'Choose an SSH host first.' });
				return;
			}
			const selected = await pickRemoteFolder(host, startPath);
			if (!selected) {
				await panel.webview.postMessage({ type: 'status', status: 'Ready', message: 'Remote folder selection cancelled.' });
				return;
			}
			await panel.webview.postMessage({ type: 'remoteFolderSelected', path: selected });
			await panel.webview.postMessage({ type: 'status', status: 'Ready', message: `Selected ${selected}` });
		}
		if (message?.type === 'chooseTarball') {
			const selected = await vscode.window.showOpenDialog({
				canSelectFiles: true,
				canSelectFolders: false,
				canSelectMany: false,
				filters: { 'Server tarball': ['gz', 'tgz'] }
			});
			const file = selected?.[0]?.fsPath;
			if (!file) {
				return;
			}
			await getSshConfiguration().update('serverTarballPath', file, vscode.ConfigurationTarget.Global);
			await auditLog.record({
				operation: 'dashboard.serverTarball.selected',
				status: 'succeeded',
				resource: file
			});
			await panel.webview.postMessage({ type: 'tarballSelected', path: file });
			await panel.webview.postMessage({ type: 'status', status: 'Ready', message: 'Server tarball selected.' });
		}
		if (message?.type === 'diagnostics') {
			await showDiagnostics(context);
		}
	}, undefined, context.subscriptions);
}

async function pickRemoteFolder(host: string, initialPath: string): Promise<string | undefined> {
	const configuration = getSshConfiguration();
	const sshPath = configuration.get<string>('sshPath') || 'ssh';
	let currentPath = initialPath || '~';

	while (true) {
		const listing = parseRemoteDirectoryListing((await sshExec(host, createListDirectoryScript(currentPath), {
			sshPath,
			timeoutMs: 15000
		})).stdout);
		currentPath = listing.path;
		const items: Array<vscode.QuickPickItem & { readonly action: 'select' | 'parent' | 'child' | 'manual'; readonly path?: string }> = [
			{ label: '$(check) Select this folder', description: currentPath, action: 'select', path: currentPath },
			{ label: '$(edit) Enter path manually', description: currentPath, action: 'manual' },
			{ label: '..', description: parentRemotePath(currentPath), action: 'parent', path: parentRemotePath(currentPath) },
			...listing.directories.map(directory => ({
				label: `$(folder) ${directory}`,
				description: joinRemotePath(currentPath, directory),
				action: 'child' as const,
				path: joinRemotePath(currentPath, directory)
			}))
		];
		const picked = await vscode.window.showQuickPick(items, {
			title: `RemoteAI SSH: ${host}`,
			placeHolder: 'Step 2: choose a remote workspace folder',
			matchOnDescription: true
		});
		if (!picked) {
			return undefined;
		}
		if (picked.action === 'select') {
			return picked.path;
		}
		if (picked.action === 'manual') {
			const typed = await vscode.window.showInputBox({
				title: `RemoteAI SSH: ${host}`,
				prompt: 'Remote folder path',
				value: currentPath
			});
			if (typed) {
				return typed.trim();
			}
			continue;
		}
		currentPath = picked.path || currentPath;
	}
}

async function resolveConfiguredServerRelease(configuration: vscode.WorkspaceConfiguration): Promise<{ commit: string; tarballPath?: string; sha256?: string }> {
	const tarballPath = configuration.get<string>('serverTarballPath') || undefined;
	if (tarballPath) {
		return { commit: configuration.get<string>('commit') || '', tarballPath };
	}
	const manifestPath = configuration.get<string>('serverManifestPath') || undefined;
	if (!manifestPath) {
		return { commit: configuration.get<string>('commit') || '' };
	}
	const manifest = JSON.parse(await fs.promises.readFile(manifestPath, 'utf8')) as RemoteAiReleaseManifest;
	const selected = selectTarballFromManifest(manifestPath, manifest);
	return { commit: selected.commit, tarballPath: selected.tarballPath, sha256: selected.sha256 };
}

async function showDiagnostics(context: vscode.ExtensionContext): Promise<void> {
	const configuration = getSshConfiguration();
	const auditPath = vscode.Uri.joinPath(context.globalStorageUri, 'remote-ai-audit.jsonl').fsPath;
	const manifestPath = configuration.get<string>('serverManifestPath') || '';
	const report = createDiagnosticsReport({
		now: new Date().toISOString(),
		appName: vscode.env.appName,
		appCommit: vscode.env.appCommit || '',
		remoteName: vscode.env.remoteName,
		workspaceFolders: (vscode.workspace.workspaceFolders ?? []).map(folder => folder.uri.toString()),
		configuration: {
			serverManifestPath: manifestPath,
			serverTarballPath: configuration.get<string>('serverTarballPath') || '',
			commit: configuration.get<string>('commit') || '',
			sshPath: configuration.get<string>('sshPath') || 'ssh',
			defaultRemotePath: configuration.get<string>('defaultRemotePath') || '~'
		},
		hostOptions: readSshHostOptions(),
		recentConnections: context.globalState.get<ConnectionHistoryEntry[]>('remoteai.ssh.connectionHistory') ?? [],
		auditPath,
		manifest: await readManifestStatus(manifestPath)
	});
	const document = await vscode.workspace.openTextDocument({ content: report, language: 'markdown' });
	await vscode.window.showTextDocument(document, { preview: false });
}

async function readManifestStatus(manifestPath: string): Promise<DiagnosticsManifestStatus> {
	if (!manifestPath) {
		return { ok: false, errors: ['serverManifestPath is not configured'] };
	}
	try {
		const manifest = JSON.parse(await fs.promises.readFile(manifestPath, 'utf8')) as RemoteAiReleaseManifest;
		const selected = selectTarballFromManifest(manifestPath, manifest);
		const errors: string[] = [];
		if (!fs.existsSync(selected.tarballPath)) {
			errors.push(`missing tarball: ${selected.tarballPath}`);
		}
		return {
			ok: errors.length === 0,
			errors,
			commit: selected.commit,
			platform: manifest.platform,
			tarballPath: selected.tarballPath,
			sha256: selected.sha256,
			size: manifest.artifact.size,
			minGlibc: manifest.compatibility?.minGlibc ?? null
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { ok: false, errors: [`manifest read failed: ${message}`] };
	}
}

function readSshHostOptions(): string[] {
	try {
		const configPath = path.join(os.homedir(), '.ssh', 'config');
		const entries = parseSshConfig(fs.readFileSync(configPath, 'utf8'));
		return [...entries.keys()].filter(host => !host.includes('*')).sort();
	} catch {
		return [];
	}
}

function createNonce(): string {
	const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let value = '';
	for (let i = 0; i < 32; i++) {
		value += alphabet[Math.floor(Math.random() * alphabet.length)];
	}
	return value;
}

function normalizeRemotePath(remotePath: string): string {
	if (remotePath === '~') {
		return '/';
	}
	return remotePath.startsWith('/') ? remotePath : `/${remotePath}`;
}
