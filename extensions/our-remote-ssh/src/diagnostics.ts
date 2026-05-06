/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ConnectionHistoryEntry } from './connectionHistory';

export interface DiagnosticsConfiguration {
	readonly serverManifestPath: string;
	readonly serverTarballPath: string;
	readonly commit: string;
	readonly sshPath: string;
	readonly defaultRemotePath: string;
}

export interface DiagnosticsManifestStatus {
	readonly ok: boolean;
	readonly commit?: string;
	readonly platform?: string;
	readonly tarballPath?: string;
	readonly sha256?: string;
	readonly size?: number;
	readonly minGlibc?: string | null;
	readonly errors: readonly string[];
}

export interface DiagnosticsSshMultiplexingStatus {
	readonly mode: string;
	readonly controlDir: string;
	readonly controlPath: string;
	readonly fallback: string;
}

export interface DiagnosticsReportInput {
	readonly now: string;
	readonly appName: string;
	readonly appCommit: string;
	readonly remoteName: string | undefined;
	readonly workspaceFolders: readonly string[];
	readonly configuration: DiagnosticsConfiguration;
	readonly hostOptions: readonly string[];
	readonly recentConnections: readonly ConnectionHistoryEntry[];
	readonly auditPath: string;
	readonly sshMultiplexing: DiagnosticsSshMultiplexingStatus;
	readonly manifest: DiagnosticsManifestStatus;
}

export function createDiagnosticsReport(input: DiagnosticsReportInput): string {
	const lines = [
		'# Aura Diagnostics',
		'',
		'## Runtime',
		`- Generated: ${input.now}`,
		`- App: ${input.appName}`,
		`- App commit: ${input.appCommit || 'unknown'}`,
		`- Remote name: ${input.remoteName || 'local'}`,
		`- Workspace folders: ${input.workspaceFolders.length ? input.workspaceFolders.join(', ') : 'none'}`,
		'',
		'## SSH Configuration',
		`- SSH path: ${input.configuration.sshPath || 'ssh'}`,
		`- Commit: ${input.configuration.commit || 'app/default'}`,
		`- Default remote path: ${input.configuration.defaultRemotePath || '~'}`,
		`- Server manifest: ${input.configuration.serverManifestPath || 'not configured'}`,
		`- Server tarball override: ${input.configuration.serverTarballPath || 'not configured'}`,
		`- SSH hosts: ${input.hostOptions.length ? input.hostOptions.join(', ') : 'none'}`,
		`- Recent: ${formatRecentConnections(input.recentConnections)}`,
		`- SSH multiplexing: ${input.sshMultiplexing.mode}`,
		`- SSH control dir: ${input.sshMultiplexing.controlDir}`,
		`- SSH control path: ${input.sshMultiplexing.controlPath}`,
		`- SSH multiplex fallback: ${input.sshMultiplexing.fallback}`,
		'',
		'## Release',
		`- Manifest: ${input.manifest.ok ? 'ok' : 'failed'}`,
		`- Release commit: ${input.manifest.commit || 'unknown'}`,
		`- Platform: ${input.manifest.platform || 'unknown'}`,
		`- Tarball: ${input.manifest.tarballPath || 'unknown'}`,
		`- SHA256: ${input.manifest.sha256 || 'unknown'}`,
		`- Size: ${typeof input.manifest.size === 'number' ? input.manifest.size : 'unknown'}`,
		`- Minimum glibc: ${input.manifest.minGlibc || 'unknown'}`,
		'',
		'## Logs',
		`- Audit: ${input.auditPath}`
	];
	if (input.manifest.errors.length) {
		lines.push('', '## Release Errors', ...input.manifest.errors.map(error => `  - ${error}`));
	}
	return `${lines.join('\n')}\n`;
}

function formatRecentConnections(entries: readonly ConnectionHistoryEntry[]): string {
	if (!entries.length) {
		return 'none';
	}
	return entries.map(entry => `${entry.host} ${entry.remotePath}`).join(', ');
}
