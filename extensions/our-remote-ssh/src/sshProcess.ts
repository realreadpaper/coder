/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawn } from 'child_process';

export interface SshExecOptions {
	readonly sshPath?: string;
	readonly timeoutMs?: number;
}

export interface SshExecResult {
	readonly code: number;
	readonly stdout: string;
	readonly stderr: string;
}

export interface SshPipeOptions extends SshExecOptions {
	readonly input: Buffer;
}

export function sshExec(host: string, script: string, options: SshExecOptions = {}): Promise<SshExecResult> {
	const sshPath = options.sshPath ?? 'ssh';
	const timeoutMs = options.timeoutMs ?? 30_000;

	return runSsh(sshPath, ['-T', host, 'sh', '-s'], Buffer.from(script), timeoutMs);
}

export function sshPipe(host: string, remoteCommand: string, options: SshPipeOptions): Promise<SshExecResult> {
	const sshPath = options.sshPath ?? 'ssh';
	const timeoutMs = options.timeoutMs ?? 30_000;

	return runSsh(sshPath, [host, remoteCommand], options.input, timeoutMs);
}

function runSsh(sshPath: string, args: string[], input: Buffer, timeoutMs: number): Promise<SshExecResult> {
	return new Promise((resolve, reject) => {
		const child = spawn(sshPath, args, { stdio: ['pipe', 'pipe', 'pipe'] });
		let stdout = '';
		let stderr = '';
		let settled = false;

		const timer = setTimeout(() => {
			if (settled) {
				return;
			}
			settled = true;
			child.kill('SIGTERM');
			reject(new Error(`SSH command timed out after ${timeoutMs}ms`));
		}, timeoutMs);

		child.stdout.on('data', chunk => stdout += chunk.toString());
		child.stderr.on('data', chunk => stderr += chunk.toString());
		child.on('error', error => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timer);
			reject(error);
		});
		child.on('close', code => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timer);
			resolve({ code: code ?? -1, stdout, stderr });
		});
		child.stdin.end(input);
	});
}
