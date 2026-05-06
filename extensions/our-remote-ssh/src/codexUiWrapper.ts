/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import { normalizeSshRemoteAuthority, parseSshRemoteAuthority, toSshRemoteAuthority } from './authority';

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
	readonly bypassApprovalsAndSandbox?: boolean;
}

export interface UnavailableCodexSshWrapperScriptOptions {
	readonly host: string;
	readonly remotePath: string;
	readonly reason: string;
}

export interface PendingCodexSshWrapperScriptOptions {
	readonly host: string;
	readonly remotePath: string;
}

export interface CodexSshWrapperPlanOptions {
	readonly globalStoragePath: string;
	readonly workspaceFolderUri: UriLike | undefined;
	readonly remoteCliPath: string;
	readonly sandboxMode: 'read-only' | 'workspace-write' | 'danger-full-access';
	readonly bypassApprovalsAndSandbox?: boolean;
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
		sandboxMode: options.sandboxMode,
		bypassApprovalsAndSandbox: options.bypassApprovalsAndSandbox ?? false
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
BYPASS_APPROVALS_AND_SANDBOX=${shellSingleQuote(options.bypassApprovalsAndSandbox ? '1' : '0')}
EXPECTED_AURA_CODE_REMOTE_AUTHORITY=${shellSingleQuote(toSshRemoteAuthority(options.host))}
EXPECTED_AURA_CODE_WORKSPACE_ROOT=${shellSingleQuote(options.remotePath)}

quote() { printf '%q' "$1"; }
${buildLocalWorkspaceGuard()}

cmd="export LC_ALL=C; export LANG=C; export LC_CTYPE=C; REMOTE_PATH=$(quote "$REMOTE_PATH"); REMOTE_CODEX_CLI=$(quote "$REMOTE_CODEX_CLI"); AURA_CODE_REMOTE_AUTHORITY=$(quote "$EXPECTED_AURA_CODE_REMOTE_AUTHORITY"); if [ ! -d \\"\$REMOTE_PATH\\" ]; then echo \\"Aura workspace does not exist: \$REMOTE_PATH\\" >&2; exit 90; fi; REMOTE_PATH=\\$(cd \\"\$REMOTE_PATH\\" && pwd -P); cd \\"\$REMOTE_PATH\\"; export AURA_CODE_REMOTE_AUTHORITY=\\"\$EXPECTED_AURA_CODE_REMOTE_AUTHORITY\\"; export AURA_CODE_WORKSPACE_ROOT=\\"\$REMOTE_PATH\\"; exec \\"\$REMOTE_CODEX_CLI\\""
if [ "\${1:-}" = "app-server" ]; then
	:
else
	cmd+=" --cd \\"\$REMOTE_PATH\\" --sandbox $(quote "$SANDBOX_MODE")"
	if [ "$BYPASS_APPROVALS_AND_SANDBOX" = "1" ]; then
		cmd+=" --dangerously-bypass-approvals-and-sandbox"
	fi
fi
for arg in "$@"; do
	cmd+=" $(quote "$arg")"
done

exec env -u LC_ALL -u LC_CTYPE LANG=C ssh -T "$HOST" "$cmd"
`;
}

export function buildPendingCodexSshWrapperScript(options: PendingCodexSshWrapperScriptOptions): string {
	return `#!/usr/bin/env bash
set -euo pipefail

HOST=${shellSingleQuote(options.host)}
REMOTE_PATH=${shellSingleQuote(options.remotePath)}
EXPECTED_AURA_CODE_REMOTE_AUTHORITY=${shellSingleQuote(toSshRemoteAuthority(options.host))}
EXPECTED_AURA_CODE_WORKSPACE_ROOT=${shellSingleQuote(options.remotePath)}

${buildLocalWorkspaceGuard()}
echo "Aura Codex runtime is still preparing for $HOST:$REMOTE_PATH" >&2
exit 92
`;
}

export function buildUnavailableCodexSshWrapperScript(options: UnavailableCodexSshWrapperScriptOptions): string {
	return `#!/usr/bin/env bash
set -euo pipefail

HOST=${shellSingleQuote(options.host)}
REMOTE_PATH=${shellSingleQuote(options.remotePath)}
REASON=${shellSingleQuote(options.reason)}
EXPECTED_AURA_CODE_REMOTE_AUTHORITY=${shellSingleQuote(toSshRemoteAuthority(options.host))}
EXPECTED_AURA_CODE_WORKSPACE_ROOT=${shellSingleQuote(options.remotePath)}

quote() { printf '%q' "$1"; }
${buildLocalWorkspaceGuard()}

cmd="export LC_ALL=C; export LANG=C; export LC_CTYPE=C; REMOTE_PATH=$(quote "$REMOTE_PATH"); REASON=$(quote "$REASON"); AURA_CODE_REMOTE_AUTHORITY=$(quote "$EXPECTED_AURA_CODE_REMOTE_AUTHORITY"); if [ ! -d \\"\$REMOTE_PATH\\" ]; then echo \\"Aura workspace does not exist: \$REMOTE_PATH\\" >&2; exit 90; fi; REMOTE_PATH=\\$(cd \\"\$REMOTE_PATH\\" && pwd -P); cd \\"\$REMOTE_PATH\\"; export AURA_CODE_REMOTE_AUTHORITY=\\"\$EXPECTED_AURA_CODE_REMOTE_AUTHORITY\\"; export AURA_CODE_WORKSPACE_ROOT=\\"\$REMOTE_PATH\\"; echo \\"Aura Codex runtime is unavailable: \$REASON\\" >&2; exit 91"

exec env -u LC_ALL -u LC_CTYPE LANG=C ssh -T "$HOST" "$cmd"
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
	if (!uri || uri.scheme !== 'vscode-remote') {
		return undefined;
	}
	const authority = normalizeSshRemoteAuthority(uri.authority);
	if (!authority.startsWith('ssh-remote+')) {
		return undefined;
	}
	const { host } = parseSshRemoteAuthority(authority);
	return {
		host,
		remotePath: uri.path || '/'
	};
}

function shellSingleQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

function buildLocalWorkspaceGuard(): string {
	return `if [ -n "\${AURA_CODE_REMOTE_AUTHORITY:-}" ] && [ "$AURA_CODE_REMOTE_AUTHORITY" != "$EXPECTED_AURA_CODE_REMOTE_AUTHORITY" ]; then
	echo "AURA_CODE_REMOTE_AUTHORITY mismatch: expected $EXPECTED_AURA_CODE_REMOTE_AUTHORITY, got $AURA_CODE_REMOTE_AUTHORITY" >&2
	exit 93
fi
if [ -n "\${AURA_CODE_WORKSPACE_ROOT:-}" ] && [ "$AURA_CODE_WORKSPACE_ROOT" != "$EXPECTED_AURA_CODE_WORKSPACE_ROOT" ]; then
	echo "AURA_CODE_WORKSPACE_ROOT mismatch: expected $EXPECTED_AURA_CODE_WORKSPACE_ROOT, got $AURA_CODE_WORKSPACE_ROOT" >&2
	exit 93
fi`;
}
