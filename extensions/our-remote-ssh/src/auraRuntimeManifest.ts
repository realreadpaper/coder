/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface AuraRuntimePlatform {
	readonly version: string;
	readonly officialUrl: string;
	readonly mirrorUrl: string;
	readonly sha256: string;
	readonly size: number;
	readonly binPath: string;
	readonly bundledPath: string;
}

export interface AuraRuntimeProvider {
	readonly displayName: string;
	readonly recommendedVersion: string;
	readonly minimumVersion: string;
	readonly bundledFallbackVersion: string;
	readonly commands: {
		readonly sidebar: string;
		readonly exec: string;
	};
	readonly platforms: Record<string, AuraRuntimePlatform>;
}

export interface AuraRuntimeManifest {
	readonly schemaVersion: 1;
	readonly providers: Record<string, AuraRuntimeProvider>;
}

const codexFallbackSha256 = '0000000000000000000000000000000000000000000000000000000000000000';

export const defaultAuraRuntimeManifest: AuraRuntimeManifest = parseAuraRuntimeManifest({
	schemaVersion: 1,
	providers: {
		codex: {
			displayName: 'Codex',
			recommendedVersion: '0.128.0',
			minimumVersion: '0.128.0',
			bundledFallbackVersion: '0.128.0',
			commands: { sidebar: 'app-server', exec: 'exec' },
			platforms: {
				'linux-x64': {
					version: '0.128.0',
					officialUrl: '',
					mirrorUrl: '',
					sha256: codexFallbackSha256,
					size: 0,
					binPath: 'bin/codex',
					bundledPath: 'runtimes/codex/0.128.0-linux-x64.tar.gz'
				},
				'linux-arm64': {
					version: '0.128.0',
					officialUrl: '',
					mirrorUrl: '',
					sha256: codexFallbackSha256,
					size: 0,
					binPath: 'bin/codex',
					bundledPath: 'runtimes/codex/0.128.0-linux-arm64.tar.gz'
				}
			}
		}
	}
});

export function parseAuraRuntimeManifest(value: unknown): AuraRuntimeManifest {
	const manifest = value as AuraRuntimeManifest;
	if (!manifest || manifest.schemaVersion !== 1 || !manifest.providers) {
		throw new Error('Aura runtime manifest must use schemaVersion 1');
	}
	for (const [providerId, provider] of Object.entries(manifest.providers)) {
		if (!provider.displayName || !provider.recommendedVersion || !provider.minimumVersion) {
			throw new Error(`Aura runtime provider ${providerId} is incomplete`);
		}
		for (const [platformKey, platform] of Object.entries(provider.platforms ?? {})) {
			if (!/^[a-f0-9]{64}$/i.test(platform.sha256)) {
				throw new Error(`Aura runtime provider ${providerId} platform ${platformKey} has invalid sha256`);
			}
			if (!platform.binPath || !platform.version || !platform.bundledPath) {
				throw new Error(`Aura runtime provider ${providerId} platform ${platformKey} is incomplete`);
			}
		}
	}
	return manifest;
}

export function selectProviderPlatform(manifest: AuraRuntimeManifest, providerId: string, platformKey: string): AuraRuntimePlatform {
	const provider = manifest.providers[providerId];
	if (!provider) {
		throw new Error(`Aura runtime manifest does not define provider ${providerId}`);
	}
	const platform = provider.platforms[platformKey];
	if (!platform) {
		throw new Error(`Aura runtime provider ${providerId} does not support ${platformKey}`);
	}
	return platform;
}
