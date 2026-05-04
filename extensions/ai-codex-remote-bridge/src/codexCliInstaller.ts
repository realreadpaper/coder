/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';

export interface CodexCliInstallPlan {
	readonly packageName: string;
	readonly installRoot: string;
	readonly binPath: string;
	readonly binaryRelativePath: string;
}

const defaultCodexCliVersion = '0.128.0';

export function codexPlatformPackage(os: string, arch: string, version = defaultCodexCliVersion): string {
	if (os !== 'linux') {
		throw new Error(`Remote Codex CLI must be Linux, got ${os}`);
	}
	if (arch === 'x64') {
		return `@openai/codex@${version}-linux-x64`;
	}
	if (arch === 'arm64') {
		return `@openai/codex@${version}-linux-arm64`;
	}
	throw new Error(`Unsupported remote Codex CLI architecture: ${arch}`);
}

export function codexBinaryRelativePath(os: string, arch: string): string {
	if (os !== 'linux') {
		throw new Error(`Remote Codex CLI must be Linux, got ${os}`);
	}
	if (arch === 'x64') {
		return 'package/vendor/x86_64-unknown-linux-musl/codex/codex';
	}
	if (arch === 'arm64') {
		return 'package/vendor/aarch64-unknown-linux-musl/codex/codex';
	}
	throw new Error(`Unsupported remote Codex CLI architecture: ${arch}`);
}

export function createCodexCliInstallPlan(globalStoragePath: string, os: string, arch: string, version = defaultCodexCliVersion): CodexCliInstallPlan {
	const platform = arch === 'x64' ? 'linux-x64' : arch === 'arm64' ? 'linux-arm64' : arch;
	const installRoot = path.posix.join(toPosix(globalStoragePath), 'codex-cli', `${version}-${platform}`);
	return {
		packageName: codexPlatformPackage(os, arch, version),
		installRoot,
		binPath: path.posix.join(installRoot, 'bin', 'codex'),
		binaryRelativePath: codexBinaryRelativePath(os, arch)
	};
}

function toPosix(value: string): string {
	return value.replace(/\\/g, '/');
}
