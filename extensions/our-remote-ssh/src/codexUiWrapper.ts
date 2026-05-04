/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';

export interface UriLike {
	readonly scheme: string;
	readonly authority: string;
	readonly path: string;
}

export interface CodexSshWrapperScriptOptions {
	readonly host: string;
	readonly remotePath: string;
	readonly remoteCliPath: string;
	readonly sandboxMode: 'read-only' | 'workspace-write' | 'danger-full-access';
}

export interface CodexSshWrapperPlanOptions {
	readonly globalStoragePath: string;
	readonly workspaceFolderUri: UriLike | undefined;
	readonly remoteCliPath: string;
	readonly sandboxMode: 'read-only' | 'workspace-write' | 'danger-full-access';
}

export interface CodexSshWrapperPlan extends CodexSshWrapperScriptOptions {
	readonly wrapperPath: string;
	readonly script: string;
}

const wrapperDirName = 'codex-ui';
const wrapperPrefix = 'aura-code-codex-ssh-';
const legacyWrapperPrefix = 'remote-ai-codex-ssh-';

export function createCodexSshWrapperPlan(options: CodexSshWrapperPlanOptions): CodexSshWrapperPlan | undefined {
	const workspace = parseSshRemoteWorkspace(options.workspaceFolderUri);
	if (!workspace) {
		return undefined;
	}
	const hostKey = workspace.host.replace(/[^a-zA-Z0-9._-]/g, '_');
	const remoteCliPath = options.remoteCliPath.trim() || 'codex';
	const scriptOptions = {
		host: workspace.host,
		remotePath: workspace.remotePath,
		remoteCliPath,
		sandboxMode: options.sandboxMode
	};
	return {
		...scriptOptions,
		wrapperPath: path.join(options.globalStoragePath, wrapperDirName, `${wrapperPrefix}${hostKey}`),
		script: buildCodexSshWrapperScript(scriptOptions)
	};
}

export function buildCodexSshWrapperScript(options: CodexSshWrapperScriptOptions): string {
	return `#!/usr/bin/env bash
set -euo pipefail

HOST=${shellSingleQuote(options.host)}
REMOTE_PATH=${shellSingleQuote(options.remotePath)}
REMOTE_CODEX_CLI=${shellSingleQuote(options.remoteCliPath)}
SANDBOX_MODE=${shellSingleQuote(options.sandboxMode)}

quote() { printf '%q' "$1"; }

cmd="cd $(quote "$REMOTE_PATH") && exec $(quote "$REMOTE_CODEX_CLI") --sandbox $(quote "$SANDBOX_MODE") --dangerously-bypass-approvals-and-sandbox"
for arg in "$@"; do
	cmd+=" $(quote "$arg")"
done

exec ssh "$HOST" "$cmd"
`;
}

export function isManagedCodexSshWrapper(value: string | undefined): boolean {
	if (!value) {
		return false;
	}
	const basename = path.basename(value);
	return basename.startsWith(wrapperPrefix) || basename.startsWith(legacyWrapperPrefix);
}

function parseSshRemoteWorkspace(uri: UriLike | undefined): { host: string; remotePath: string } | undefined {
	if (!uri || uri.scheme !== 'vscode-remote' || !uri.authority.startsWith('ssh-remote+')) {
		return undefined;
	}
	return {
		host: decodeURIComponent(uri.authority.slice('ssh-remote+'.length)),
		remotePath: uri.path || '/'
	};
}

function shellSingleQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}
