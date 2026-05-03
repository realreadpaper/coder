/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChildProcess, spawn } from 'child_process';
import * as net from 'net';
import { AuditLogWriter } from './auditLog';

export interface SshTunnelOptions {
	readonly sshPath?: string;
	readonly localPort?: number;
	readonly remoteHost?: string;
	readonly timeoutMs?: number;
	readonly skipReadyCheck?: boolean;
}

export interface SshTunnel {
	readonly localPort: number;
	readonly remoteHost: string;
	readonly remotePort: number;
	readonly process: ChildProcess;
	dispose(): void;
}

export async function openSshTunnel(
	host: string,
	remotePort: number,
	auditLog: AuditLogWriter,
	options: SshTunnelOptions = {}
): Promise<SshTunnel> {
	const sshPath = options.sshPath ?? 'ssh';
	const localPort = options.localPort ?? await findFreePort();
	const remoteHost = options.remoteHost ?? '127.0.0.1';
	const timeoutMs = options.timeoutMs ?? 10_000;
	const forwardSpec = `127.0.0.1:${localPort}:${remoteHost}:${remotePort}`;

	await auditLog.record({
		operation: 'tunnel.open',
		status: 'started',
		authority: `ssh-remote+${host}`,
		metadata: { localPort, remoteHost, remotePort }
	});

	const child = spawn(sshPath, ['-N', '-L', forwardSpec, host], { stdio: ['ignore', 'pipe', 'pipe'] });
	let stderr = '';
	child.stderr?.on('data', chunk => stderr += chunk.toString());

	try {
		if (!options.skipReadyCheck) {
			await waitForLocalPort(localPort, timeoutMs);
		}
		await auditLog.record({
			operation: 'tunnel.open',
			status: 'succeeded',
			authority: `ssh-remote+${host}`,
			metadata: { localPort, remoteHost, remotePort }
		});
	} catch (error) {
		child.kill('SIGTERM');
		await auditLog.record({
			operation: 'tunnel.open',
			status: 'failed',
			authority: `ssh-remote+${host}`,
			metadata: { localPort, remoteHost, remotePort, stderr, error: String(error) }
		});
		throw error;
	}

	return {
		localPort,
		remoteHost,
		remotePort,
		process: child,
		dispose: () => child.kill('SIGTERM')
	};
}

async function findFreePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = net.createServer();
		server.on('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();
			if (!address || typeof address === 'string') {
				server.close();
				reject(new Error('Unable to allocate local port'));
				return;
			}
			const port = address.port;
			server.close(error => error ? reject(error) : resolve(port));
		});
	});
}

async function waitForLocalPort(port: number, timeoutMs: number): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	let lastError: Error | undefined;
	while (Date.now() < deadline) {
		try {
			await tryConnect(port);
			return;
		} catch (error) {
			lastError = error as Error;
			await sleep(50);
		}
	}
	throw new Error(`Timed out waiting for local tunnel port ${port}: ${lastError?.message ?? 'unknown error'}`);
}

function tryConnect(port: number): Promise<void> {
	return new Promise((resolve, reject) => {
		const socket = net.createConnection({ host: '127.0.0.1', port });
		socket.once('connect', () => {
			socket.end();
			resolve();
		});
		socket.once('error', reject);
	});
}

function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}
