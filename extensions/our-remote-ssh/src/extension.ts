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
import { resolveServerRelease } from './serverRelease';
import { resolveSshRemoteAuthority, ResolvedSshRemote } from './resolver';
import { parseSshConfig } from './sshConfig';
import { createSshConfigEntry, createSshHostOptions, SshHostOption } from './sshHosts';
import { sshExec, sshPipe } from './sshProcess';
import { buildUnavailableCodexSshWrapperScript, createCodexSshWrapperPlan, isManagedCodexSshWrapper } from './codexUiWrapper';
import { isSameRemoteWorkspace, normalizeRemotePath } from './workspaceTarget';
import { AuraRuntimeManifest, defaultAuraRuntimeManifest, parseAuraRuntimeManifest, selectProviderPlatform } from './auraRuntimeManifest';
import { buildAuraRuntimeInstallScript, buildAuraRuntimeProbeScript, buildAuraRuntimeRemoteDownloadScript, createAuraRuntimeUploadPlan, parseAuraRuntimeProbeOutput } from './auraRuntimeInstaller';
import { createAuraRuntimeEnsurePlan } from './auraRuntimeBinding';
import { AuraRuntimeSource, chooseAuraRuntimeSource, downloadAuraRuntime, hashAuraRuntimeFile } from './auraRuntimeSource';
import { buildCodexCredentialSyncPayload, buildCodexCredentialSyncScript, codexCredentialRelativePaths, CodexCredentialSourceFile } from './codexCredentials';
import { codexSecondarySidebarSupportContext, codexSidebarPlacementDelays, shouldForceCodexSecondarySidebar } from './codexSidebarPlacement';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext): void {
	const output = vscode.window.createOutputChannel('Aura SSH');
	context.subscriptions.push(output);
	const codexRuntimeStatus = createCodexRuntimeStatusBarItem();
	context.subscriptions.push(codexRuntimeStatus);
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

	configureCodexSidebarPlacement(context, output, auditLog);
	void configureCodexUiForWorkspace(context, output, auditLog, codexRuntimeStatus);
	context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => {
		void configureCodexUiForWorkspace(context, output, auditLog, codexRuntimeStatus);
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
		const host = await pickSshHost();
		if (!host) {
			return;
		}

		const configuredPath = getSshConfiguration().get<string>('defaultRemotePath') || '~';
		const remotePath = await pickRemoteFolder(host, configuredPath);
		if (!remotePath) {
			return;
		}

		await configureCodexUiForSshTarget(context, output, auditLog, codexRuntimeStatus, host, remotePath);
		await openRemoteFolder(host, remotePath);
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
			const release = await resolveConfiguredServerRelease(configuration, context.extensionUri.fsPath);
			const commit = release.commit || vscode.env.appCommit || 'dev';
			const serverTarballPath = release.tarballPath;
			const sshPath = configuration.get<string>('sshPath') || 'ssh';
			const connectionToken = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
			output.appendLine(`Resolving ${authority} with commit ${commit}`);
			await auditLog.record({
				operation: 'remoteAuthority.resolve',
				status: 'started',
				authority,
				metadata: { commit, hasServerTarballPath: Boolean(serverTarballPath), sshPath, releaseSource: release.source }
			});

			try {
				if (!serverTarballPath) {
					throw new Error('Aura Code could not find a bundled remote server release. Run scripts/remote-ai-package-release.sh before scripts/remote-ai-package-darwin.sh, or configure remoteai.ssh.serverManifestPath.');
				}
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
					metadata: { commit, localPort: resolved.authority.port, serverDir: resolved.install.serverDir, releaseSource: release.source }
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
					metadata: { commit, error: message, releaseSource: release.source }
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

type CodexRuntimeStatusState =
	| { readonly kind: 'localDisabled' }
	| { readonly kind: 'checking'; readonly host: string; readonly remotePath: string }
	| { readonly kind: 'active'; readonly host: string; readonly remotePath: string; readonly remoteCliPath: string }
	| { readonly kind: 'unavailable'; readonly host: string; readonly remotePath: string; readonly reason: string };

function createCodexRuntimeStatusBarItem(): vscode.StatusBarItem {
	const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 98);
	item.name = 'Aura Codex Runtime';
	item.command = 'remoteai.ssh.showDiagnostics';
	updateCodexRuntimeStatus(item, { kind: 'localDisabled' });
	return item;
}

function updateCodexRuntimeStatus(item: vscode.StatusBarItem, state: CodexRuntimeStatusState): void {
	item.backgroundColor = undefined;
	if (state.kind === 'localDisabled') {
		item.text = '$(circle-large-outline) Aura Codex: local mode';
		item.tooltip = 'Local file workspaces use the local Codex CLI. SSH workspaces use the remote Codex CLI only.';
		item.show();
		return;
	}
	if (state.kind === 'checking') {
		item.text = '$(sync~spin) Aura Codex: checking';
		item.tooltip = `Preparing Remote Codex CLI on ${state.host}:${state.remotePath}`;
		item.show();
		return;
	}
	if (state.kind === 'active') {
		item.text = '$(check) Aura Codex: remote active';
		item.tooltip = `Remote Codex CLI is active on ${state.host}:${state.remotePath}\nRemote Codex CLI: ${state.remoteCliPath}`;
		item.show();
		return;
	}
	item.text = '$(warning) Aura Codex: remote unavailable';
	item.tooltip = `Remote Codex CLI is not active for ${state.host}:${state.remotePath}\n${state.reason}`;
	item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
	item.show();
}

function configureCodexSidebarPlacement(
	context: vscode.ExtensionContext,
	output: vscode.OutputChannel,
	auditLog: AuditLogWriter
): void {
	const forceSecondarySidebar = async (extensionId?: string) => {
		if (!shouldForceCodexSecondarySidebar(extensionId)) {
			return;
		}
		try {
			await vscode.commands.executeCommand('setContext', codexSecondarySidebarSupportContext, false);
			await auditLog.record({
				operation: 'codex.sidebar.placement',
				status: 'succeeded',
				metadata: { extensionId: extensionId ?? 'startup', location: 'secondarySidebar' }
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			output.appendLine(`Unable to force Codex secondary sidebar placement: ${message}`);
			await auditLog.record({
				operation: 'codex.sidebar.placement',
				status: 'failed',
				metadata: { extensionId: extensionId ?? 'startup', error: message }
			});
		}
	};

	for (const delay of codexSidebarPlacementDelays) {
		const handle = setTimeout(() => {
			void forceSecondarySidebar();
		}, delay);
		context.subscriptions.push({ dispose: () => clearTimeout(handle) });
	}
	context.subscriptions.push(vscode.extensions.onDidChange(() => {
		void forceSecondarySidebar('openai.chatgpt');
	}));
}

async function configureCodexUiForWorkspace(
	context: vscode.ExtensionContext,
	output: vscode.OutputChannel,
	auditLog: AuditLogWriter,
	codexRuntimeStatus: vscode.StatusBarItem
): Promise<void> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	await configureCodexUiForWorkspaceUri(context, output, auditLog, codexRuntimeStatus, folder?.uri);
}

async function configureCodexUiForSshTarget(
	context: vscode.ExtensionContext,
	output: vscode.OutputChannel,
	auditLog: AuditLogWriter,
	codexRuntimeStatus: vscode.StatusBarItem,
	host: string,
	remotePath: string
): Promise<void> {
	await configureCodexUiForWorkspaceUri(context, output, auditLog, codexRuntimeStatus, vscode.Uri.from({
		scheme: 'vscode-remote',
		authority: toSshRemoteAuthority(host),
		path: normalizeRemotePath(remotePath)
	}));
}

async function configureCodexUiForWorkspaceUri(
	context: vscode.ExtensionContext,
	output: vscode.OutputChannel,
	auditLog: AuditLogWriter,
	codexRuntimeStatus: vscode.StatusBarItem,
	workspaceFolderUri: vscode.Uri | undefined
): Promise<void> {
	const codexConfiguration = vscode.workspace.getConfiguration('remoteai.codex');
	const sandboxMode = codexConfiguration.get<'read-only' | 'workspace-write' | 'danger-full-access'>('sandboxMode') || 'danger-full-access';
	let plan = createCodexSshWrapperPlan({
		globalStoragePath: context.globalStorageUri.fsPath,
		workspaceFolderUri,
		remoteCliPath: codexConfiguration.get<string>('remoteCliPath') || '',
		sandboxMode
	});
	const chatgptConfiguration = vscode.workspace.getConfiguration('chatgpt');
	const currentCliExecutable = chatgptConfiguration.get<string>('cliExecutable') || '';

	if (!plan) {
		updateCodexRuntimeStatus(codexRuntimeStatus, { kind: 'localDisabled' });
		if (isManagedCodexSshWrapper(currentCliExecutable)) {
			try {
				await setChatGptCliExecutable(context, chatgptConfiguration, undefined);
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
	const remoteHost = plan.host;
	updateCodexRuntimeStatus(codexRuntimeStatus, { kind: 'checking', host: remoteHost, remotePath: plan.remotePath });
	try {
		const probeResult = await sshExec(remoteHost, buildAuraRuntimeProbeScript(), { sshPath });
		if (probeResult.code !== 0) {
			throw new Error(`Aura runtime probe failed\nstdout:\n${probeResult.stdout}\nstderr:\n${probeResult.stderr}`);
		}
		const probe = parseAuraRuntimeProbeOutput(probeResult.stdout);
		const runtimeConfiguration = vscode.workspace.getConfiguration('aura.runtime');
		const runtimeManifest = await resolveAuraRuntimeManifest(runtimeConfiguration);
		const runtimePlatform = selectProviderPlatform(runtimeManifest, 'codex', probe.platformKey);
		const ensurePlan = createAuraRuntimeEnsurePlan({
			providerId: 'codex',
			home: probe.home,
			platformKey: probe.platformKey,
			configuredRemoteCliPath: codexConfiguration.get<string>('remoteCliPath') || '',
			registry: probe.registry,
			requiredVersion: runtimePlatform.version,
			binRelativePath: runtimePlatform.binPath
		});
		const remoteCliPath = ensurePlan.action === 'install' ? ensurePlan.target.binPath : ensurePlan.binPath;
		if (ensurePlan.action === 'install') {
			const bundledRoot = await resolveAuraRuntimeBundledRoot(runtimeConfiguration, context.extensionUri.fsPath);
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
				networkAvailable: runtimeConfiguration.get<boolean>('networkEnabled') ?? true,
				remoteDownloadEnabled: runtimeConfiguration.get<boolean>('remoteDownloadEnabled') ?? true
			});
			const upload = createAuraRuntimeUploadPlan({
				home: probe.home,
				providerId: 'codex',
				version: runtimePlatform.version,
				platformKey: probe.platformKey
			});
			let installSourceKind = source.kind;
			const uploadLocalRuntime = async (localSource: Exclude<AuraRuntimeSource, { readonly kind: 'remoteDownload' }>) => {
				const localTarballPath = localSource.kind === 'download'
					? await downloadAuraRuntime(localSource.url, localSource.cachePath)
					: localSource.path;
				const actualSha256 = await hashAuraRuntimeFile(localTarballPath);
				if (runtimePlatform.sha256 !== '0000000000000000000000000000000000000000000000000000000000000000' && actualSha256 !== runtimePlatform.sha256) {
					throw new Error(`Aura runtime sha256 mismatch for ${localTarballPath}: ${actualSha256}`);
				}
				const tarball = await fs.promises.readFile(localTarballPath);
				const uploadResult = await sshPipe(remoteHost, upload.remoteCommand, { input: tarball, sshPath });
				if (uploadResult.code !== 0) {
					throw new Error(`Aura runtime upload failed\nstdout:\n${uploadResult.stdout}\nstderr:\n${uploadResult.stderr}`);
				}
			};
			if (source.kind === 'remoteDownload') {
				const downloadResult = await sshExec(remoteHost, buildAuraRuntimeRemoteDownloadScript({
					url: source.url,
					remotePath: upload.remotePath
				}), { sshPath, timeoutMs: 120_000 });
				if (downloadResult.code !== 0) {
					output.appendLine(`Aura runtime remote download failed; falling back to local download/upload.\nstdout:\n${downloadResult.stdout}\nstderr:\n${downloadResult.stderr}`);
					const fallbackSource = chooseAuraRuntimeSource({
						providerId: 'codex',
						platformKey: probe.platformKey,
						version: runtimePlatform.version,
						cachePath,
						cacheExists: await pathExists(cachePath),
						bundledPath,
						bundledExists: await pathExists(bundledPath),
						officialUrl: runtimePlatform.officialUrl,
						mirrorUrl: runtimePlatform.mirrorUrl,
						networkAvailable: runtimeConfiguration.get<boolean>('networkEnabled') ?? true,
						remoteDownloadEnabled: false
					});
					if (fallbackSource.kind === 'remoteDownload') {
						throw new Error('Aura runtime fallback source unexpectedly selected remote download.');
					}
					installSourceKind = fallbackSource.kind;
					await uploadLocalRuntime(fallbackSource);
				}
			} else {
				await uploadLocalRuntime(source);
			}
			const installResult = await sshExec(remoteHost, buildAuraRuntimeInstallScript({
				providerId: 'codex',
				version: runtimePlatform.version,
				platformKey: probe.platformKey,
				uploadPath: upload.remotePath,
				installDir: ensurePlan.target.installDir,
				binRelativePath: ensurePlan.target.binRelativePath,
				sha256: runtimePlatform.sha256,
				sourceKind: installSourceKind
			}), { sshPath, timeoutMs: 120_000 });
			if (installResult.code !== 0) {
				throw new Error(`Aura runtime install failed\nstdout:\n${installResult.stdout}\nstderr:\n${installResult.stderr}`);
			}
		}
		await syncCodexCredentialsForRemote(remoteHost, probe.home, sshPath, codexConfiguration, output, auditLog);
		plan = createCodexSshWrapperPlan({
			globalStoragePath: context.globalStorageUri.fsPath,
			workspaceFolderUri,
			remoteCliPath,
			sandboxMode
		}) ?? plan;
		output.appendLine(`Aura Code selected Codex runtime: ${remoteCliPath}`);
		updateCodexRuntimeStatus(codexRuntimeStatus, { kind: 'active', host: remoteHost, remotePath: plan.remotePath, remoteCliPath });
		await auditLog.record({
			operation: 'aura.runtime.bind',
			status: 'succeeded',
			authority: `ssh-remote+${encodeURIComponent(remoteHost)}`,
			workspaceRoot: plan.remotePath,
			metadata: { action: ensurePlan.action, remoteCliPath, platformKey: probe.platformKey }
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		output.appendLine(`Aura Code runtime binding failed: ${message}`);
		updateCodexRuntimeStatus(codexRuntimeStatus, { kind: 'unavailable', host: remoteHost, remotePath: plan.remotePath, reason: message });
		await auditLog.record({
			operation: 'aura.runtime.bind',
			status: 'failed',
			authority: `ssh-remote+${encodeURIComponent(remoteHost)}`,
			workspaceRoot: plan.remotePath,
			metadata: { error: message }
		});
		plan = {
			...plan,
			remoteCliPath: '',
			script: buildUnavailableCodexSshWrapperScript({
				host: plan.host,
				remotePath: plan.remotePath,
				reason: message
			})
		};
	}

	await fs.promises.mkdir(path.dirname(plan.wrapperPath), { recursive: true });
	await fs.promises.writeFile(plan.wrapperPath, plan.script, { mode: 0o755 });
	await fs.promises.chmod(plan.wrapperPath, 0o755);
	if (currentCliExecutable !== plan.wrapperPath) {
		try {
			await setChatGptCliExecutable(context, chatgptConfiguration, plan.wrapperPath);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			output.appendLine(`Unable to configure Codex sidebar CLI setting: ${message}`);
			updateCodexRuntimeStatus(codexRuntimeStatus, { kind: 'unavailable', host: plan.host, remotePath: plan.remotePath, reason: message });
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
		output.appendLine('Aura configured the Codex sidebar for this SSH workspace before Codex starts.');
	}
}

async function setChatGptCliExecutable(
	context: vscode.ExtensionContext,
	configuration: vscode.WorkspaceConfiguration,
	value: string | undefined
): Promise<void> {
	try {
		await configuration.update('cliExecutable', value, vscode.ConfigurationTarget.Global);
		return;
	} catch (error) {
		try {
			await writeChatGptCliExecutableFallback(context, value);
			return;
		} catch (fallbackError) {
			const primaryMessage = error instanceof Error ? error.message : String(error);
			const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
			throw new Error(`${primaryMessage}; settings.json fallback failed: ${fallbackMessage}`);
		}
	}
}

async function writeChatGptCliExecutableFallback(context: vscode.ExtensionContext, value: string | undefined): Promise<void> {
	const settingsPath = path.resolve(context.globalStorageUri.fsPath, '..', '..', 'settings.json');
	let settings: Record<string, unknown> = {};
	try {
		const content = await fs.promises.readFile(settingsPath, 'utf8');
		settings = parseJsonObjectWithComments(content);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
			throw error;
		}
	}
	if (value === undefined) {
		delete settings['chatgpt.cliExecutable'];
	} else {
		settings['chatgpt.cliExecutable'] = value;
	}
	await fs.promises.mkdir(path.dirname(settingsPath), { recursive: true });
	await fs.promises.writeFile(settingsPath, `${JSON.stringify(settings, null, '\t')}\n`, 'utf8');
}

function parseJsonObjectWithComments(content: string): Record<string, unknown> {
	const parsed = JSON.parse(stripJsonComments(content)) as unknown;
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		return {};
	}
	return parsed as Record<string, unknown>;
}

function stripJsonComments(content: string): string {
	let result = '';
	let inString = false;
	let quote = '';
	let escaped = false;
	for (let index = 0; index < content.length; index++) {
		const char = content[index];
		const next = content[index + 1];
		if (inString) {
			result += char;
			if (escaped) {
				escaped = false;
			} else if (char === '\\') {
				escaped = true;
			} else if (char === quote) {
				inString = false;
			}
			continue;
		}
		if (char === '"' || char === '\'') {
			inString = true;
			quote = char;
			result += char;
			continue;
		}
		if (char === '/' && next === '/') {
			while (index < content.length && content[index] !== '\n') {
				index++;
			}
			result += '\n';
			continue;
		}
		if (char === '/' && next === '*') {
			index += 2;
			while (index < content.length && !(content[index] === '*' && content[index + 1] === '/')) {
				index++;
			}
			index++;
			continue;
		}
		result += char;
	}
	return result.replace(/,\s*([}\]])/g, '$1');
}

async function resolveAuraRuntimeManifest(configuration: vscode.WorkspaceConfiguration): Promise<AuraRuntimeManifest> {
	const manifestPath = configuration.get<string>('manifestPath') || '';
	if (!manifestPath) {
		return defaultAuraRuntimeManifest;
	}
	return parseAuraRuntimeManifest(JSON.parse(await fs.promises.readFile(manifestPath, 'utf8')));
}

async function resolveAuraRuntimeBundledRoot(configuration: vscode.WorkspaceConfiguration, extensionPath: string): Promise<string> {
	const configuredRoot = configuration.get<string>('bundledRoot') || '';
	if (configuredRoot) {
		return configuredRoot;
	}
	const candidates = [
		path.join(extensionPath, 'resources', 'aura-code'),
		path.resolve(extensionPath, '..', '..', 'resources', 'aura-code'),
		path.resolve(extensionPath, '..', '..', '..', 'aura-code')
	];
	for (const candidate of candidates) {
		if (await pathExists(candidate)) {
			return candidate;
		}
	}
	return candidates[0];
}

async function syncCodexCredentialsForRemote(
	host: string,
	remoteHome: string,
	sshPath: string,
	codexConfiguration: vscode.WorkspaceConfiguration,
	output: vscode.OutputChannel,
	auditLog: AuditLogWriter
): Promise<void> {
	if (!(codexConfiguration.get<boolean>('credentialsSyncEnabled') ?? true)) {
		return;
	}

	const localFiles = await readLocalCodexCredentialFiles(path.join(os.homedir(), '.codex'));
	if (!localFiles.length) {
		output.appendLine('Aura Code did not find local Codex credentials to sync.');
		await auditLog.record({
			operation: 'codex.credentials.sync',
			status: 'succeeded',
			authority: `ssh-remote+${encodeURIComponent(host)}`,
			metadata: { files: 0 }
		});
		return;
	}

	const payload = buildCodexCredentialSyncPayload(localFiles);
	let result;
	try {
		result = await sshPipe(host, buildCodexCredentialSyncScript({
			remoteCodexHome: path.posix.join(remoteHome, '.codex'),
			overwrite: codexConfiguration.get<boolean>('credentialsOverwrite') ?? false
		}), {
			input: Buffer.from(JSON.stringify(payload)),
			sshPath,
			timeoutMs: 15000
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		output.appendLine(`Aura Code Codex credential sync failed: ${message}`);
		await auditLog.record({
			operation: 'codex.credentials.sync',
			status: 'failed',
			authority: `ssh-remote+${encodeURIComponent(host)}`,
			metadata: { files: payload.files.map(file => file.relativePath), error: message }
		});
		return;
	}
	if (result.code !== 0) {
		output.appendLine(`Aura Code Codex credential sync failed: ${result.stderr || result.stdout}`);
		await auditLog.record({
			operation: 'codex.credentials.sync',
			status: 'failed',
			authority: `ssh-remote+${encodeURIComponent(host)}`,
			metadata: { files: payload.files.map(file => file.relativePath), error: result.stderr || result.stdout }
		});
		return;
	}

	output.appendLine(`Aura Code synced Codex credentials to ${host}.`);
	await auditLog.record({
		operation: 'codex.credentials.sync',
		status: 'succeeded',
		authority: `ssh-remote+${encodeURIComponent(host)}`,
		metadata: { files: payload.files.map(file => file.relativePath), overwrite: codexConfiguration.get<boolean>('credentialsOverwrite') ?? false }
	});
}

async function readLocalCodexCredentialFiles(localCodexHome: string): Promise<CodexCredentialSourceFile[]> {
	const files: CodexCredentialSourceFile[] = [];
	for (const relativePath of codexCredentialRelativePaths) {
		const filePath = path.join(localCodexHome, relativePath);
		if (!await pathExists(filePath)) {
			continue;
		}
		const content = await fs.promises.readFile(filePath);
		files.push({ relativePath, content, mode: 0o600 });
	}
	return files;
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
		'Aura SSH',
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

type SshHostQuickPickAction = 'typedHost' | 'configuredHost' | 'addHost' | 'configureHosts';
type SshHostQuickPickItem = vscode.QuickPickItem & {
	readonly action: SshHostQuickPickAction;
	readonly host?: string;
};

async function pickSshHost(): Promise<string | undefined> {
	const configuredHosts = readConfiguredSshHostOptions();
	const quickPick = vscode.window.createQuickPick<SshHostQuickPickItem>();
	quickPick.title = 'Select configured SSH host or enter user@host';
	quickPick.placeholder = 'e.g. ubuntu@ec2-3-106-99.amazonaws.com, or named host below';
	quickPick.matchOnDescription = true;
	quickPick.ignoreFocusOut = true;

	const updateItems = (value: string): void => {
		quickPick.items = createSshHostQuickPickItems(configuredHosts, value);
	};
	updateItems('');

	return await new Promise<string | undefined>(resolve => {
		let settled = false;
		const disposables: vscode.Disposable[] = [];
		const disposeQuickPick = (): void => {
			for (const disposable of disposables) {
				disposable.dispose();
			}
			quickPick.dispose();
		};
		const finish = (host: string | undefined): void => {
			if (settled) {
				return;
			}
			settled = true;
			disposeQuickPick();
			resolve(host);
		};

		disposables.push(quickPick.onDidChangeValue(updateItems));
		disposables.push(quickPick.onDidHide(() => finish(undefined)));
		disposables.push(quickPick.onDidAccept(async () => {
			const picked = quickPick.activeItems[0];
			if (!picked) {
				return;
			}
			if (picked.action === 'addHost') {
				settled = true;
				disposeQuickPick();
				const addedHost = await addNewSshHost();
				resolve(addedHost);
				return;
			}
			if (picked.action === 'configureHosts') {
				settled = true;
				disposeQuickPick();
				await openSshConfigFile();
				resolve(undefined);
				return;
			}
			finish(picked.host?.trim());
		}));

		quickPick.show();
	});
}

function createSshHostQuickPickItems(configuredHosts: SshHostOption[], inputValue: string): SshHostQuickPickItem[] {
	const typedHost = inputValue.trim();
	const hasExactConfiguredHost = configuredHosts.some(option => option.host === typedHost);
	const items: SshHostQuickPickItem[] = [];

	if (typedHost && !hasExactConfiguredHost) {
		items.push({
			label: `$(terminal) ${typedHost}`,
			description: 'Connect to entered host',
			action: 'typedHost',
			host: typedHost
		});
	}

	for (const option of configuredHosts) {
		items.push({
			label: `$(server) ${option.host}`,
			description: option.description,
			action: 'configuredHost',
			host: option.host
		});
	}

	items.push(
		{
			label: '$(plus) Add New SSH Host...',
			description: sshConfigPath(),
			action: 'addHost'
		},
		{
			label: '$(settings-gear) Configure SSH Hosts...',
			description: sshConfigPath(),
			action: 'configureHosts'
		}
	);

	return items;
}

async function addNewSshHost(): Promise<string | undefined> {
	const value = await vscode.window.showInputBox({
		title: 'Add New SSH Host',
		prompt: 'Enter user@host, host, or host:port. Aura Code will append it to ~/.ssh/config.',
		placeHolder: 'ubuntu@203.0.113.10',
		ignoreFocusOut: true,
		validateInput: input => {
			try {
				createSshConfigEntry(input);
				return undefined;
			} catch (error) {
				return error instanceof Error ? error.message : String(error);
			}
		}
	});
	if (!value) {
		return undefined;
	}

	const entry = createSshConfigEntry(value);
	const configPath = sshConfigPath();
	await fs.promises.mkdir(path.dirname(configPath), { recursive: true });
	const prefix = await pathExists(configPath) && (await fs.promises.readFile(configPath, 'utf8')).trim().length > 0 ? '\n\n' : '';
	await fs.promises.appendFile(configPath, `${prefix}${entry.content}`, { mode: 0o600 });
	const openNow = await vscode.window.showInformationMessage(`Added SSH host "${entry.alias}" to ~/.ssh/config.`, 'Open Config', 'Connect');
	if (openNow === 'Open Config') {
		await openSshConfigFile();
		return undefined;
	}
	return entry.alias;
}

async function openSshConfigFile(): Promise<void> {
	const configPath = sshConfigPath();
	await fs.promises.mkdir(path.dirname(configPath), { recursive: true });
	if (!await pathExists(configPath)) {
		await fs.promises.writeFile(configPath, '', { mode: 0o600 });
	}
	const document = await vscode.workspace.openTextDocument(vscode.Uri.file(configPath));
	await vscode.window.showTextDocument(document, { preview: false });
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
			title: `Aura SSH: ${host}`,
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
				title: `Aura SSH: ${host}`,
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

async function resolveConfiguredServerRelease(configuration: vscode.WorkspaceConfiguration, extensionPath: string): Promise<{ commit: string; tarballPath?: string; sha256?: string; source: string }> {
	return resolveServerRelease({
		serverTarballPath: configuration.get<string>('serverTarballPath') || undefined,
		serverManifestPath: configuration.get<string>('serverManifestPath') || undefined,
		commit: configuration.get<string>('commit') || undefined
	}, {
		extensionPath,
		appCommit: vscode.env.appCommit || undefined
	});
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

function readConfiguredSshHostOptions(): SshHostOption[] {
	try {
		const entries = parseSshConfig(fs.readFileSync(sshConfigPath(), 'utf8'));
		return createSshHostOptions(entries);
	} catch {
		return createSshHostOptions(new Map());
	}
}

function readSshHostOptions(): string[] {
	return readConfiguredSshHostOptions().map(option => option.host);
}

function sshConfigPath(): string {
	return path.join(os.homedir(), '.ssh', 'config');
}

function createNonce(): string {
	const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let value = '';
	for (let i = 0; i < 32; i++) {
		value += alphabet[Math.floor(Math.random() * alphabet.length)];
	}
	return value;
}
