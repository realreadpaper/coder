/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type AuraRuntimeSource =
	| { readonly kind: 'cache'; readonly path: string }
	| { readonly kind: 'download'; readonly url: string; readonly cachePath: string }
	| { readonly kind: 'bundled'; readonly path: string };

export interface AuraRuntimeSourceOptions {
	readonly providerId: string;
	readonly platformKey: string;
	readonly version: string;
	readonly cachePath: string;
	readonly cacheExists: boolean;
	readonly bundledPath: string;
	readonly bundledExists: boolean;
	readonly officialUrl: string;
	readonly mirrorUrl: string;
	readonly networkAvailable: boolean;
}

export function chooseAuraRuntimeSource(options: AuraRuntimeSourceOptions): AuraRuntimeSource {
	if (options.cacheExists) {
		return { kind: 'cache', path: options.cachePath };
	}
	if (options.networkAvailable && options.officialUrl) {
		return { kind: 'download', url: options.officialUrl, cachePath: options.cachePath };
	}
	if (options.networkAvailable && options.mirrorUrl) {
		return { kind: 'download', url: options.mirrorUrl, cachePath: options.cachePath };
	}
	if (options.bundledExists) {
		return { kind: 'bundled', path: options.bundledPath };
	}
	throw new Error(`No Aura runtime source available for ${options.providerId} ${options.version} ${options.platformKey}`);
}
