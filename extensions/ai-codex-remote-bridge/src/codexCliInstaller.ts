/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';

export interface CodexCliInstallPlan {
	readonly packageName: string;
	readonly installRoot: string;
	readonly binPath: string;
}

export function codexPlatformPackage(os: string, arch: string): string {
	if (os !== 'linux') {
		throw new Error(`Remote Codex CLI must be Linux, got ${os}`);
	}
	if (arch === 'x64') {
		return '@openai/codex-linux-x64';
	}
	if (arch === 'arm64') {
		return '@openai/codex-linux-arm64';
	}
	throw new Error(`Unsupported remote Codex CLI architecture: ${arch}`);
}

export function createCodexCliInstallPlan(globalStoragePath: string, os: string, arch: string): CodexCliInstallPlan {
	const installRoot = path.posix.join(toPosix(globalStoragePath), 'codex-cli');
	return {
		packageName: codexPlatformPackage(os, arch),
		installRoot,
		binPath: path.posix.join(installRoot, 'bin', 'codex')
	};
}

function toPosix(value: string): string {
	return value.replace(/\\/g, '/');
}
