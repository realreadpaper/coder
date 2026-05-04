/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AuraRuntimeRegistry } from './auraRuntimeInstaller';
import { CodexRuntimeInstallTarget, createCodexRuntimeInstallTarget } from './codexRuntimeProvider';

export type AuraRuntimeEnsurePlan =
	| { readonly action: 'use-configured'; readonly binPath: string }
	| { readonly action: 'use-existing'; readonly binPath: string }
	| { readonly action: 'install'; readonly target: CodexRuntimeInstallTarget };

export function createAuraRuntimeEnsurePlan(options: {
	readonly providerId: 'codex';
	readonly home: string;
	readonly platformKey: string;
	readonly configuredRemoteCliPath: string;
	readonly registry: AuraRuntimeRegistry;
	readonly requiredVersion: string;
}): AuraRuntimeEnsurePlan {
	const configured = options.configuredRemoteCliPath.trim();
	if (configured) {
		return { action: 'use-configured', binPath: configured };
	}
	const existing = options.registry.runtimes[options.providerId];
	if (existing?.version === options.requiredVersion && existing.binPath) {
		return { action: 'use-existing', binPath: existing.binPath };
	}
	return {
		action: 'install',
		target: createCodexRuntimeInstallTarget({
			home: options.home,
			platformKey: options.platformKey,
			version: options.requiredVersion
		})
	};
}
