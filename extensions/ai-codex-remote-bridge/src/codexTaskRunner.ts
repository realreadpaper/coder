/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'child_process';
import * as path from 'path';
export interface CodexTaskOptions {
	readonly workspaceRoot: string;
	readonly prompt: string;
	readonly sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access';
	readonly bypassApprovalsAndSandbox?: boolean;
	readonly additionalWritableRoots?: readonly string[];
	readonly skipGitRepoCheck?: boolean;
	readonly outputLastMessagePath?: string;
}

export interface CodexTaskRunOptions extends CodexTaskOptions {
	readonly codexPath: string;
	readonly timeoutMs?: number;
	readonly killAfterMs?: number;
	readonly maxOutputBytes?: number;
}

export interface CodexTaskResult {
	readonly command: string;
	readonly args: string[];
	readonly stdout: string;
	readonly stderr: string;
	readonly outputLastMessagePath?: string;
}

export function buildCodexExecArgs(options: CodexTaskOptions): string[] {
	const args = [
		'exec',
		'--cd',
		options.workspaceRoot,
		'--sandbox',
		options.sandboxMode ?? 'danger-full-access'
	];
	for (const writableRoot of uniqueNonEmpty(options.additionalWritableRoots ?? [])) {
		args.push('--add-dir', writableRoot);
	}
	if (options.bypassApprovalsAndSandbox ?? false) {
		args.push('--dangerously-bypass-approvals-and-sandbox');
	}
	if (options.skipGitRepoCheck ?? true) {
		args.push('--skip-git-repo-check');
	}
	if (options.outputLastMessagePath) {
		args.push('--output-last-message', options.outputLastMessagePath);
	}
	args.push(options.prompt);
	return args;
}

export async function runCodexWorkspaceTask(options: CodexTaskRunOptions): Promise<CodexTaskResult> {
	const args = buildCodexExecArgs(options);
	const binDir = path.dirname(options.codexPath);
	const { stdout, stderr } = await spawnCodex(options.codexPath, args, {
		cwd: options.workspaceRoot,
		env: {
			...process.env,
			PATH: binDir === '.' ? process.env.PATH : extendPath(binDir)
		}
	}, {
		timeoutMs: options.timeoutMs,
		killAfterMs: options.killAfterMs,
		maxOutputBytes: options.maxOutputBytes
	});
	return {
		command: options.codexPath,
		args,
		stdout,
		stderr,
		outputLastMessagePath: options.outputLastMessagePath
	};
}

export interface SpawnCodexOptions {
	readonly timeoutMs?: number;
	readonly killAfterMs?: number;
	readonly maxOutputBytes?: number;
	readonly signal?: AbortSignal;
}

export function spawnCodex(command: string, args: readonly string[], options: cp.SpawnOptions, runnerOptions: SpawnCodexOptions = {}): Promise<{ stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		const child = cp.spawn(command, args, {
			...options,
			stdio: ['ignore', 'pipe', 'pipe']
		});
		const timeoutMs = runnerOptions.timeoutMs ?? 30_000;
		const killAfterMs = runnerOptions.killAfterMs ?? 2_000;
		const maxOutputBytes = runnerOptions.maxOutputBytes ?? 1024 * 1024;
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
			runnerOptions.signal?.removeEventListener('abort', abort);
		};
		const terminate = (): void => {
			child.kill('SIGTERM');
			killTimer = setTimeout(() => {
				child.kill('SIGKILL');
			}, killAfterMs);
		};
		const fail = (error: Error): void => {
			if (settled || failure) {
				return;
			}
			failure = error;
			terminate();
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
				fail(new Error(`Codex output exceeded ${maxOutputBytes} bytes`));
			}
		};
		const abort = (): void => fail(new Error('Codex command aborted'));
		const timer = setTimeout(() => {
			fail(new Error(`Codex timed out after ${timeoutMs}ms`));
		}, timeoutMs);
		if (runnerOptions.signal?.aborted) {
			abort();
		} else {
			runnerOptions.signal?.addEventListener('abort', abort);
		}
		child.stdout?.on('data', chunk => appendOutput(stdout, Buffer.from(chunk)));
		child.stderr?.on('data', chunk => appendOutput(stderr, Buffer.from(chunk)));
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
			if (code === 0) {
				resolve({ stdout: stdoutText, stderr: stderrText });
				return;
			}
			const error = new Error(`Codex exited with code ${code}`);
			Object.assign(error, { code, stdout: stdoutText, stderr: stderrText });
			reject(error);
		});
	});
}

function extendPath(binDir: string): string {
	const current = process.env.PATH ?? '';
	return current.includes(binDir) ? current : `${binDir}${path.delimiter}${current}`;
}

function uniqueNonEmpty(values: readonly string[]): string[] {
	return Array.from(new Set(values.filter(value => value.length > 0)));
}
