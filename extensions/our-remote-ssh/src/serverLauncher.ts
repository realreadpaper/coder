/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChildProcess, spawn } from 'child_process';
import { AuditLogWriter } from './auditLog';
import { parseServerListening, ServerEndpoint } from './logParser';

export interface ServerLaunchOptions {
	readonly sshPath?: string;
	readonly timeoutMs?: number;
	readonly connectionToken: string;
	readonly serverDataDir?: string;
	readonly extensionsDir?: string;
}

export interface LaunchedRemoteServer {
	readonly endpoint: ServerEndpoint;
	readonly process: ChildProcess;
	dispose(): void;
}

export async function launchRemoteServer(
	host: string,
	serverDir: string,
	auditLog: AuditLogWriter,
	options: ServerLaunchOptions
): Promise<LaunchedRemoteServer> {
	const sshPath = options.sshPath ?? 'ssh';
	const timeoutMs = options.timeoutMs ?? 30_000;
	const command = createServerCommand(serverDir, options);

	await auditLog.record({
		operation: 'server.launch',
		status: 'started',
		authority: `ssh-remote+${host}`,
		metadata: { serverDir }
	});

	return new Promise((resolve, reject) => {
		const child = spawn(sshPath, ['-T', host, command], { stdio: ['ignore', 'pipe', 'pipe'] });
		let output = '';
		let settled = false;

		const fail = async (error: Error): Promise<void> => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timer);
			child.kill('SIGTERM');
			await auditLog.record({
				operation: 'server.launch',
				status: 'failed',
				authority: `ssh-remote+${host}`,
				metadata: { serverDir, error: error.message, output }
			});
			reject(error);
		};

		const timer = setTimeout(() => {
			void fail(new Error(`Remote server launch timed out after ${timeoutMs}ms`));
		}, timeoutMs);

		const consume = (chunk: Buffer): void => {
			output += chunk.toString();
			const endpoint = parseServerListening(output);
			if (!endpoint || settled) {
				return;
			}

			settled = true;
			clearTimeout(timer);
			void auditLog.record({
				operation: 'server.launch',
				status: 'succeeded',
				authority: `ssh-remote+${host}`,
				metadata: { serverDir, endpoint }
			}).then(() => {
				resolve({
					endpoint,
					process: child,
					dispose: () => child.kill('SIGTERM')
				});
			}, reject);
		};

		child.stdout?.on('data', consume);
		child.stderr?.on('data', consume);
		child.on('error', error => void fail(error));
		child.on('close', code => {
			if (!settled) {
				void fail(new Error(`Remote server closed before listening marker, code=${code}`));
			}
		});
	});
}

function createServerCommand(serverDir: string, options: ServerLaunchOptions): string {
	const serverDataDir = options.serverDataDir ?? `${serverDir}/data`;
	const extensionsDir = options.extensionsDir ?? `${serverDir}/extensions`;
	return [
		shellQuote(`${serverDir}/bin/remote-ai-server`),
		'--start-server',
		'--host',
		'127.0.0.1',
		'--port',
		'0',
		'--connection-token',
		shellQuote(options.connectionToken),
		'--server-data-dir',
		shellQuote(serverDataDir),
		'--extensions-dir',
		shellQuote(extensionsDir)
	].join(' ');
}

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}
