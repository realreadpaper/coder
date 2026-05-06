/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export interface SshExecOptions {
	readonly sshPath?: string;
	readonly timeoutMs?: number;
	readonly killAfterMs?: number;
	readonly maxOutputBytes?: number;
	readonly signal?: AbortSignal;
}

export interface SshExecResult {
	readonly code: number;
	readonly stdout: string;
	readonly stderr: string;
	readonly multiplexing: 'enabled' | 'disabled' | 'fallback';
}

export interface SshPipeOptions extends SshExecOptions {
	readonly input: Buffer;
}

export interface SshMultiplexingDiagnostics {
	readonly mode: 'auto';
	readonly controlDir: string;
	readonly controlPath: string;
	readonly fallback: 'on-compatibility-error';
}

export function buildSshArgs(args: string[], options: { readonly multiplexing?: boolean } = {}): string[] {
	const controlPath = getSshControlPath();
	const baseArgs = [
		'-o', 'ConnectTimeout=10',
		'-o', 'ServerAliveInterval=30',
		'-o', 'ServerAliveCountMax=3'
	];
	if (options.multiplexing === false) {
		return [
			...baseArgs,
			...args
		];
	}
	return [
		'-o', 'ControlMaster=auto',
		'-o', 'ControlPersist=10m',
		'-o', `ControlPath=${controlPath}`,
		...baseArgs,
		...args
	];
}

export function getSshMultiplexingDiagnostics(): SshMultiplexingDiagnostics {
	const controlPath = getSshControlPath();
	return {
		mode: 'auto',
		controlDir: path.dirname(controlPath),
		controlPath,
		fallback: 'on-compatibility-error'
	};
}

export function sshExec(host: string, script: string, options: SshExecOptions = {}): Promise<SshExecResult> {
	const sshPath = options.sshPath ?? 'ssh';

	return runSsh(sshPath, ['-T', host, 'sh', '-s'], Buffer.from(script), options);
}

export function sshPipe(host: string, remoteCommand: string, options: SshPipeOptions): Promise<SshExecResult> {
	const sshPath = options.sshPath ?? 'ssh';

	return runSsh(sshPath, [host, remoteCommand], options.input, options);
}

async function runSsh(sshPath: string, args: string[], input: Buffer, options: SshExecOptions): Promise<SshExecResult> {
	const firstResult = await runSshOnce(sshPath, buildSshArgs(args), input, options, 'enabled');
	if (firstResult.code !== 0 && isMultiplexingCompatibilityError(firstResult.stderr)) {
		const fallbackResult = await runSshOnce(sshPath, buildSshArgs(args, { multiplexing: false }), input, options, 'fallback');
		return fallbackResult;
	}
	return firstResult;
}

function runSshOnce(
	sshPath: string,
	args: string[],
	input: Buffer,
	options: SshExecOptions,
	multiplexing: 'enabled' | 'disabled' | 'fallback'
): Promise<SshExecResult> {
	return new Promise((resolve, reject) => {
		const child = spawn(sshPath, args, { stdio: ['pipe', 'pipe', 'pipe'] });
		const timeoutMs = options.timeoutMs ?? 30_000;
		const killAfterMs = options.killAfterMs ?? 2_000;
		const maxOutputBytes = options.maxOutputBytes ?? 1024 * 1024;
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];
		let outputBytes = 0;
		let settled = false;
		let failure: Error | undefined;
		let killTimer: NodeJS.Timeout | undefined;

		const cleanup = (): void => {
			clearTimeout(timer);
			if (killTimer) {
				clearTimeout(killTimer);
			}
			options.signal?.removeEventListener('abort', abort);
		};

		const terminate = (): void => {
			child.kill('SIGTERM');
			killTimer = setTimeout(() => {
				child.kill('SIGKILL');
			}, killAfterMs);
		};

		const fail = (error: Error): void => {
			if (settled) {
				return;
			}
			if (!failure) {
				failure = error;
				terminate();
			}
		};

		const appendOutput = (target: Buffer[], chunk: Buffer): void => {
			if (failure) {
				return;
			}
			const remaining = maxOutputBytes - outputBytes;
			if (remaining > 0) {
				target.push(Buffer.from(chunk.subarray(0, remaining)));
			}
			outputBytes += chunk.length;
			if (outputBytes > maxOutputBytes) {
				fail(new Error(`SSH command output exceeded ${maxOutputBytes} bytes`));
			}
		};

		const abort = (): void => fail(new Error('SSH command aborted'));
		const timer = setTimeout(() => {
			fail(new Error(`SSH command timed out after ${timeoutMs}ms`));
		}, timeoutMs);

		if (options.signal?.aborted) {
			abort();
		} else {
			options.signal?.addEventListener('abort', abort);
		}
		child.stdout.on('data', chunk => appendOutput(stdout, Buffer.from(chunk)));
		child.stderr.on('data', chunk => appendOutput(stderr, Buffer.from(chunk)));
		child.on('error', error => {
			if (settled) {
				return;
			}
			settled = true;
			cleanup();
			reject(error);
		});
		child.on('close', code => {
			if (settled) {
				return;
			}
			settled = true;
			cleanup();
			const stdoutText = Buffer.concat(stdout).toString('utf8');
			const stderrText = Buffer.concat(stderr).toString('utf8');
			if (failure) {
				Object.assign(failure, { code, stdout: stdoutText, stderr: stderrText });
				reject(failure);
				return;
			}
			resolve({ code: code ?? -1, stdout: stdoutText, stderr: stderrText, multiplexing });
		});
		child.stdin.on('error', () => undefined);
		child.stdin.end(input);
	});
}

function isMultiplexingCompatibilityError(stderr: string): boolean {
	return /Bad configuration option:.*ControlMaster/i.test(stderr)
		|| /Bad configuration option:.*ControlPath/i.test(stderr)
		|| /ControlPath.*too long/i.test(stderr)
		|| /mux_client_request_session/i.test(stderr);
}

function getSshControlPath(): string {
	const uid = typeof process.getuid === 'function' ? process.getuid() : undefined;
	const controlDir = path.join('/tmp', uid === undefined ? 'aura-ssh' : `aura-ssh-${uid}`);
	fs.mkdirSync(controlDir, { recursive: true, mode: 0o700 });
	fs.chmodSync(controlDir, 0o700);
	return path.join(controlDir, '%C');
}
