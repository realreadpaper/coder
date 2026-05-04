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
import { sshExec, sshPipe } from './sshProcess';
import { createCodexSshWrapperPlan, isManagedCodexSshWrapper } from './codexUiWrapper';
import { isSameRemoteWorkspace, normalizeRemotePath } from './workspaceTarget';
import { defaultAuraRuntimeManifest, selectProviderPlatform } from './auraRuntimeManifest';
import { buildAuraRuntimeInstallScript, buildAuraRuntimeProbeScript, createAuraRuntimeUploadPlan, parseAuraRuntimeProbeOutput } from './auraRuntimeInstaller';
import { createAuraRuntimeEnsurePlan } from './auraRuntimeBinding';
import { chooseAuraRuntimeSource, downloadAuraRuntime, hashAuraRuntimeFile } from './auraRuntimeSource';
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

	void configureCodexUiForWorkspace(context, output, auditLog);
	context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => {
		void configureCodexUiForWorkspace(context, output, auditLog);
	}));

	const openRemoteFolder = async (host: string, remotePath: string): Promise<'already-connected' | 'opened'> => {
		const authority = toSshRemoteAuthority(host);
		await auditLog.record({
			operation: 'remote.openFolder.request',
			status: 'started',
			authority,
			workspaceRoot: remotePath
		});
		if (isSameRemoteWorkspace(vscode.workspace.workspaceFolders, host, remotePath)) {
			await auditLog.record({
				operation: 'remote.openFolder.request',
				status: 'succeeded',
				authority,
				workspaceRoot: remotePath,
				metadata: { result: 'already-connected' }
			});
			return 'already-connected';
		}
		await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.from({
			scheme: 'vscode-remote',
			authority,
			path: normalizeRemotePath(remotePath)
		}), false);
		await auditLog.record({
			operation: 'remote.openFolder.request',
			status: 'succeeded',
			authority,
			workspaceRoot: remotePath,
			metadata: { result: 'open-folder-dispatched' }
		});
		return 'opened';
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

async function configureCodexUiForWorkspace(
	context: vscode.ExtensionContext,
	output: vscode.OutputChannel,
	auditLog: AuditLogWriter
): Promise<void> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	const codexConfiguration = vscode.workspace.getConfiguration('remoteai.codex');
	const sandboxMode = codexConfiguration.get<'read-only' | 'workspace-write' | 'danger-full-access'>('sandboxMode') || 'danger-full-access';
	let plan = createCodexSshWrapperPlan({
		globalStoragePath: context.globalStorageUri.fsPath,
		workspaceFolderUri: folder?.uri,
		remoteCliPath: codexConfiguration.get<string>('remoteCliPath') || '',
		sandboxMode
	});
	const chatgptConfiguration = vscode.workspace.getConfiguration('chatgpt');
	const currentCliExecutable = chatgptConfiguration.get<string>('cliExecutable') || '';

	if (!plan) {
		if (isManagedCodexSshWrapper(currentCliExecutable)) {
			try {
				await chatgptConfiguration.update('cliExecutable', undefined, vscode.ConfigurationTarget.Global);
			} catch (error) {
				output.appendLine(`Unable to clear Codex sidebar CLI setting: ${error instanceof Error ? error.message : String(error)}`);
				return;
			}
			output.appendLine('Restored Codex sidebar CLI to the local default for this local workspace.');
			await auditLog.record({
				operation: 'codex.ui.configure',
				status: 'succeeded',
				metadata: { mode: 'local' }
			});
		}
		return;
	}

	const sshPath = getSshConfiguration().get<string>('sshPath') || 'ssh';
	try {
		const probeResult = await sshExec(plan.host, buildAuraRuntimeProbeScript(), { sshPath });
		if (probeResult.code !== 0) {
			throw new Error(`Aura runtime probe failed\nstdout:\n${probeResult.stdout}\nstderr:\n${probeResult.stderr}`);
		}
		const probe = parseAuraRuntimeProbeOutput(probeResult.stdout);
		const runtimePlatform = selectProviderPlatform(defaultAuraRuntimeManifest, 'codex', probe.platformKey);
		const ensurePlan = createAuraRuntimeEnsurePlan({
			providerId: 'codex',
			home: probe.home,
			platformKey: probe.platformKey,
			configuredRemoteCliPath: codexConfiguration.get<string>('remoteCliPath') || '',
			registry: probe.registry,
			requiredVersion: runtimePlatform.version
		});
		const remoteCliPath = ensurePlan.action === 'install' ? ensurePlan.target.binPath : ensurePlan.binPath;
		if (ensurePlan.action === 'install') {
			const runtimeConfiguration = vscode.workspace.getConfiguration('aura.runtime');
			const bundledRoot = runtimeConfiguration.get<string>('bundledRoot') || path.join(context.extensionUri.fsPath, 'resources', 'aura-code');
			const cachePath = path.join(context.globalStorageUri.fsPath, 'runtimes', 'cache', 'codex', `${runtimePlatform.version}-${probe.platformKey}.tar.gz`);
			const bundledPath = path.join(bundledRoot, runtimePlatform.bundledPath);
			const source = chooseAuraRuntimeSource({
				providerId: 'codex',
				platformKey: probe.platformKey,
				version: runtimePlatform.version,
				cachePath,
				cacheExists: await pathExists(cachePath),
				bundledPath,
				bundledExists: await pathExists(bundledPath),
				officialUrl: runtimePlatform.officialUrl,
				mirrorUrl: runtimePlatform.mirrorUrl,
				networkAvailable: runtimeConfiguration.get<boolean>('networkEnabled') ?? true
			});
			const localTarballPath = source.kind === 'download'
				? await downloadAuraRuntime(source.url, source.cachePath)
				: source.path;
			const actualSha256 = await hashAuraRuntimeFile(localTarballPath);
			if (runtimePlatform.sha256 !== '0000000000000000000000000000000000000000000000000000000000000000' && actualSha256 !== runtimePlatform.sha256) {
				throw new Error(`Aura runtime sha256 mismatch for ${localTarballPath}: ${actualSha256}`);
			}
			const upload = createAuraRuntimeUploadPlan({
				home: probe.home,
				providerId: 'codex',
				version: runtimePlatform.version,
				platformKey: probe.platformKey
			});
			const tarball = await fs.promises.readFile(localTarballPath);
			const uploadResult = await sshPipe(plan.host, upload.remoteCommand, { input: tarball, sshPath });
			if (uploadResult.code !== 0) {
				throw new Error(`Aura runtime upload failed\nstdout:\n${uploadResult.stdout}\nstderr:\n${uploadResult.stderr}`);
			}
			const installResult = await sshExec(plan.host, buildAuraRuntimeInstallScript({
				providerId: 'codex',
				version: runtimePlatform.version,
				platformKey: probe.platformKey,
				uploadPath: upload.remotePath,
				installDir: ensurePlan.target.installDir,
				binRelativePath: ensurePlan.target.binRelativePath,
				sha256: runtimePlatform.sha256,
				sourceKind: source.kind
			}), { sshPath, timeoutMs: 120_000 });
			if (installResult.code !== 0) {
				throw new Error(`Aura runtime install failed\nstdout:\n${installResult.stdout}\nstderr:\n${installResult.stderr}`);
			}
		}
		plan = createCodexSshWrapperPlan({
			globalStoragePath: context.globalStorageUri.fsPath,
			workspaceFolderUri: folder?.uri,
			remoteCliPath,
			sandboxMode
		}) ?? plan;
		output.appendLine(`Aura Code selected Codex runtime: ${remoteCliPath}`);
		await auditLog.record({
			operation: 'aura.runtime.bind',
			status: 'succeeded',
			authority: `ssh-remote+${encodeURIComponent(plan.host)}`,
			workspaceRoot: plan.remotePath,
			metadata: { action: ensurePlan.action, remoteCliPath, platformKey: probe.platformKey }
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		output.appendLine(`Aura Code runtime binding failed: ${message}`);
		await auditLog.record({
			operation: 'aura.runtime.bind',
			status: 'failed',
			authority: `ssh-remote+${encodeURIComponent(plan.host)}`,
			workspaceRoot: plan.remotePath,
			metadata: { error: message }
		});
	}

	await fs.promises.mkdir(path.dirname(plan.wrapperPath), { recursive: true });
	await fs.promises.writeFile(plan.wrapperPath, plan.script, { mode: 0o755 });
	await fs.promises.chmod(plan.wrapperPath, 0o755);
	if (currentCliExecutable !== plan.wrapperPath) {
		try {
			await chatgptConfiguration.update('cliExecutable', plan.wrapperPath, vscode.ConfigurationTarget.Global);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			output.appendLine(`Unable to configure Codex sidebar CLI setting: ${message}`);
			await auditLog.record({
				operation: 'codex.ui.configure',
				status: 'failed',
				authority: `ssh-remote+${encodeURIComponent(plan.host)}`,
				workspaceRoot: plan.remotePath,
				metadata: { wrapperPath: plan.wrapperPath, remoteCliPath: plan.remoteCliPath, error: message }
			});
			return;
		}
		output.appendLine(`Configured Codex sidebar for ${plan.host}:${plan.remotePath}`);
		output.appendLine(`Codex UI wrapper: ${plan.wrapperPath}`);
		await auditLog.record({
			operation: 'codex.ui.configure',
			status: 'succeeded',
			authority: `ssh-remote+${encodeURIComponent(plan.host)}`,
			workspaceRoot: plan.remotePath,
			metadata: { wrapperPath: plan.wrapperPath, remoteCliPath: plan.remoteCliPath }
		});
		const action = await vscode.window.showInformationMessage(
			'RemoteAI configured the Codex sidebar for this SSH workspace. Reload the window to restart the Codex app-server in the remote workspace.',
			'Reload Window'
		);
		if (action === 'Reload Window') {
			await vscode.commands.executeCommand('workbench.action.reloadWindow');
		}
	}
}

async function pathExists(filePath: string): Promise<boolean> {
	try {
		await fs.promises.access(filePath);
		return true;
	} catch {
		return false;
	}
}

function openDashboard(
	context: vscode.ExtensionContext,
	auditLog: AuditLogWriter,
	openRemoteFolder: (host: string, remotePath: string) => Promise<'already-connected' | 'opened'>
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
				const result = await openRemoteFolder(host, remotePath);
				await auditLog.record({
					operation: 'dashboard.connect.request',
					status: 'succeeded',
					authority: toSshRemoteAuthority(host),
					workspaceRoot: remotePath,
					metadata: { result }
				});
				if (result === 'already-connected') {
					await panel.webview.postMessage({ type: 'status', status: 'Connected', message: `Already connected to ${host}:${remotePath}` });
				}
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
