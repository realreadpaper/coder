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
}

export type InstallServerFn = (host: string, commit: string) => Promise<RemoteServerInstall>;
export type LaunchServerFn = (host: string, serverDir: string) => Promise<DisposableServer>;
export type OpenTunnelFn = (host: string, remotePort: number) => Promise<DisposableTunnel>;

export async function resolveSshRemoteAuthority(authority: string, options: ResolveSshRemoteOptions): Promise<ResolvedSshRemote> {
	const target = parseSshRemoteAuthority(authority);
	if (!options.localTarballPath && !options.installServer) {
		throw new Error('RemoteAI SSH requires remoteai.ssh.serverTarballPath until server download support is configured');
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

// Keep structural compatibility explicit without exposing child_process in resolver tests.
const _typeCheckServer: LaunchedRemoteServer | undefined = undefined;
const _typeCheckTunnel: SshTunnel | undefined = undefined;
void _typeCheckServer;
void _typeCheckTunnel;
