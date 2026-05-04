/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';

export interface CodexRuntimeInstallTargetOptions {
	readonly home: string;
	readonly platformKey: string;
	readonly version: string;
}

export interface CodexRuntimeInstallTarget {
	readonly installDir: string;
	readonly binPath: string;
	readonly uploadPath: string;
	readonly binRelativePath: 'bin/codex';
}

export function createCodexRuntimeInstallTarget(options: CodexRuntimeInstallTargetOptions): CodexRuntimeInstallTarget {
	const installDir = path.posix.join(options.home, '.aura-code', 'runtimes', 'codex', `${options.version}-${options.platformKey}`);
	return {
		installDir,
		binPath: path.posix.join(installDir, 'bin', 'codex'),
		uploadPath: path.posix.join(options.home, '.aura-code', 'upload', `codex-${options.version}-${options.platformKey}.tar.gz`),
		binRelativePath: 'bin/codex'
	};
}

export function legacyCodexRemoteCliPath(home: string, version: string, platformKey: string): string {
	return path.posix.join(home, '.remote-ai-server', 'codex', `${version}-${platformKey}`, 'bin', 'codex');
}
