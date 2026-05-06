/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AuditLogWriter } from './auditLog';
import { parseSshRemoteAuthority } from './authority';
import { ensureRemoteServerInstalled, RemoteServerInstall } from './serverInstaller';
import { launchRemoteServer, LaunchedRemoteServer } from './serverLauncher';
import { openSshTunnel, SshTunnel } from './tunnelManager';

export interface ResolvedSshAuthority {
	readonly host: string;
	readonly port: number;
	readonly connectionToken: string;
}

export interface ResolvedSshRemote {
	readonly authority: ResolvedSshAuthority;
	readonly install: RemoteServerInstall;
	readonly server: DisposableServer;
	readonly tunnel: DisposableTunnel;
	dispose(): void;
}

export interface DisposableServer {
	readonly endpoint: {
		readonly host: string;
		readonly port: number;
	};
	dispose(): void;
}

export interface DisposableTunnel {
	readonly localPort: number;
	readonly remoteHost: string;
	readonly remotePort: number;
	dispose(): void;
}

export interface ResolveSshRemoteOptions {
	readonly commit: string;
	readonly connectionToken: string;
	readonly localTarballPath?: string;
	readonly sha256?: string;
	readonly sshPath?: string;
	readonly auditLog: AuditLogWriter;
	readonly installServer?: InstallServerFn;
	readonly launchServer?: LaunchServerFn;
	readonly openTunnel?: OpenTunnelFn;
	readonly healthCheck?: ConnectionHealthCheckFn;
}

export type InstallServerFn = (host: string, commit: string) => Promise<RemoteServerInstall>;
export type LaunchServerFn = (host: string, serverDir: string) => Promise<DisposableServer>;
export type OpenTunnelFn = (host: string, remotePort: number) => Promise<DisposableTunnel>;
export type ConnectionHealthCheckFn = (connection: ResolvedSshRemote) => boolean | Promise<boolean>;

interface ManagedConnectionEntry {
	readonly key: string;
	readonly promise: Promise<ResolvedSshRemote>;
	refCount: number;
	disposed: boolean;
	connection?: ResolvedSshRemote;
}

export class ConnectionManager {
	private readonly entries = new Map<string, ManagedConnectionEntry>();

	async acquire(authority: string, options: ResolveSshRemoteOptions): Promise<ResolvedSshRemote> {
		const key = createConnectionKey(authority, options.commit);
		let entry = this.entries.get(key);
		if (entry?.connection && options.healthCheck) {
			const healthy = await options.healthCheck(entry.connection);
			if (!healthy) {
				this.disposeEntry(entry);
				entry = undefined;
			}
		}

		if (!entry) {
			const createdEntry: ManagedConnectionEntry = {
				key,
				promise: resolveSshRemoteAuthority(authority, options),
				refCount: 0,
				disposed: false
			};
			this.entries.set(key, createdEntry);
			createdEntry.promise.then(connection => {
				if (createdEntry.disposed) {
					connection.dispose();
					return;
				}
				createdEntry.connection = connection;
			}, () => {
				if (this.entries.get(key) === createdEntry) {
					this.entries.delete(key);
				}
			});
			entry = createdEntry;
		}

		entry.refCount++;
		try {
			const connection = await entry.promise;
			return this.createHandle(entry, connection);
		} catch (error) {
			this.releaseEntry(entry);
			throw error;
		}
	}

	reconnect(authority: string, options: ResolveSshRemoteOptions): Promise<ResolvedSshRemote> {
		const key = createConnectionKey(authority, options.commit);
		const entry = this.entries.get(key);
		if (entry) {
			this.disposeEntry(entry);
		}
		return this.acquire(authority, options);
	}

	dispose(): void {
		for (const entry of this.entries.values()) {
			this.disposeEntry(entry);
		}
		this.entries.clear();
	}

	private createHandle(entry: ManagedConnectionEntry, connection: ResolvedSshRemote): ResolvedSshRemote {
		let released = false;
		return {
			authority: connection.authority,
			install: connection.install,
			server: connection.server,
			tunnel: connection.tunnel,
			dispose: () => {
				if (released) {
					return;
				}
				released = true;
				this.releaseEntry(entry);
			}
		};
	}

	private releaseEntry(entry: ManagedConnectionEntry): void {
		if (entry.disposed || this.entries.get(entry.key) !== entry) {
			return;
		}
		entry.refCount = Math.max(0, entry.refCount - 1);
		if (entry.refCount === 0) {
			this.disposeEntry(entry);
		}
	}

	private disposeEntry(entry: ManagedConnectionEntry): void {
		if (entry.disposed) {
			return;
		}
		entry.disposed = true;
		if (this.entries.get(entry.key) === entry) {
			this.entries.delete(entry.key);
		}
		if (entry.connection) {
			entry.connection.dispose();
			return;
		}
		entry.promise.then(connection => connection.dispose(), () => undefined);
	}
}

export async function resolveSshRemoteAuthority(authority: string, options: ResolveSshRemoteOptions): Promise<ResolvedSshRemote> {
	const target = parseSshRemoteAuthority(authority);
	if (!options.localTarballPath && !options.installServer) {
		throw new Error('Aura SSH requires remoteai.ssh.serverTarballPath until server download support is configured');
	}

	const installServer = options.installServer ?? ((host, commit) => ensureRemoteServerInstalled(host, commit, options.auditLog, {
		localTarballPath: options.localTarballPath,
		sha256: options.sha256,
		sshPath: options.sshPath
	}));
	const launchServer = options.launchServer ?? ((host, serverDir) => launchRemoteServer(host, serverDir, options.auditLog, {
		connectionToken: options.connectionToken,
		sshPath: options.sshPath
	}));
	const createTunnel = options.openTunnel ?? ((host, remotePort) => openSshTunnel(host, remotePort, options.auditLog, {
		sshPath: options.sshPath
	}));

	let server: DisposableServer | undefined;
	let tunnel: DisposableTunnel | undefined;

	try {
		const install = await installServer(target.host, options.commit);
		server = await launchServer(target.host, install.serverDir);
		tunnel = await createTunnel(target.host, server.endpoint.port);

		return {
			authority: {
				host: '127.0.0.1',
				port: tunnel.localPort,
				connectionToken: options.connectionToken
			},
			install,
			server,
			tunnel,
			dispose: () => {
				tunnel?.dispose();
				server?.dispose();
			}
		};
	} catch (error) {
		tunnel?.dispose();
		server?.dispose();
		throw error;
	}
}

function createConnectionKey(authority: string, commit: string): string {
	const target = parseSshRemoteAuthority(authority);
	return `${target.host}\0${commit}`;
}

// Keep structural compatibility explicit without exposing child_process in resolver tests.
const _typeCheckServer: LaunchedRemoteServer | undefined = undefined;
const _typeCheckTunnel: SshTunnel | undefined = undefined;
void _typeCheckServer;
void _typeCheckTunnel;
