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
	if (options.bypassApprovalsAndSandbox ?? true) {
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
	const { stdout, stderr } = await spawnCodex(options.codexPath, args, {
		cwd: options.workspaceRoot,
		env: {
			...process.env,
			PATH: extendPath(path.dirname(options.codexPath))
		}
	});
	return {
		command: options.codexPath,
		args,
		stdout,
		stderr,
		outputLastMessagePath: options.outputLastMessagePath
	};
}

export function spawnCodex(command: string, args: readonly string[], options: cp.SpawnOptions): Promise<{ stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		const child = cp.spawn(command, args, {
			...options,
			stdio: ['ignore', 'pipe', 'pipe']
		});
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];
		child.stdout?.on('data', chunk => stdout.push(Buffer.from(chunk)));
		child.stderr?.on('data', chunk => stderr.push(Buffer.from(chunk)));
		child.on('error', reject);
		child.on('close', code => {
			const stdoutText = Buffer.concat(stdout).toString('utf8');
			const stderrText = Buffer.concat(stderr).toString('utf8');
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
