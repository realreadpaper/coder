/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import { createCodexCliInstallPlan } from './codexCliInstaller';
import { CodexTaskResult, runCodexWorkspaceTask } from './codexTaskRunner';

export interface RemoteCodexPathOptions {
	readonly remoteCliPath?: string;
	readonly globalStoragePath: string;
	readonly platform?: NodeJS.Platform;
	readonly arch?: string;
}

export interface RemoteCodexTaskPlan {
	readonly codexPath: string;
	readonly workspaceRoot: string;
	readonly prompt: string;
	readonly sandboxMode: 'read-only' | 'workspace-write' | 'danger-full-access';
	readonly outputLastMessagePath: string;
	readonly additionalWritableRoots: readonly string[];
}

export interface RemoteCodexTaskOptions extends RemoteCodexPathOptions {
	readonly workspaceRoot: string;
	readonly prompt: string;
	readonly sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access';
	readonly outputLastMessagePath?: string;
}

export function resolveRemoteCodexPath(options: RemoteCodexPathOptions): string {
	const configured = options.remoteCliPath?.trim();
	if (configured) {
		return configured;
	}
	return createCodexCliInstallPlan(
		options.globalStoragePath,
		options.platform ?? process.platform,
		options.arch ?? process.arch
	).binPath;
}

export function defaultRemoteCodexStateRoot(globalStoragePath: string): string {
	return toPosix(globalStoragePath);
}

export function createRemoteCodexTaskPlan(options: RemoteCodexTaskOptions): RemoteCodexTaskPlan {
	const workspaceRoot = toPosix(options.workspaceRoot);
	const outputLastMessagePath = options.outputLastMessagePath
		? toPosix(options.outputLastMessagePath)
		: path.posix.join(workspaceRoot, '.remote-ai-codex', 'last-message.md');
	return {
		codexPath: resolveRemoteCodexPath(options),
		workspaceRoot,
		prompt: options.prompt,
		sandboxMode: options.sandboxMode ?? 'danger-full-access',
		outputLastMessagePath,
		additionalWritableRoots: [defaultRemoteCodexStateRoot(options.globalStoragePath)]
	};
}

export async function runRemoteCodexWorkspaceTask(options: RemoteCodexTaskOptions): Promise<CodexTaskResult> {
	const plan = createRemoteCodexTaskPlan(options);
	await fs.promises.mkdir(path.posix.dirname(plan.outputLastMessagePath), { recursive: true });
	return runCodexWorkspaceTask({
		codexPath: plan.codexPath,
		workspaceRoot: plan.workspaceRoot,
		prompt: plan.prompt,
		sandboxMode: plan.sandboxMode,
		additionalWritableRoots: plan.additionalWritableRoots,
		outputLastMessagePath: plan.outputLastMessagePath
	});
}

function toPosix(value: string): string {
	return value.replace(/\\/g, '/');
}
