/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as https from 'https';
import * as path from 'path';

export type AuraRuntimeSource =
	| { readonly kind: 'cache'; readonly path: string }
	| { readonly kind: 'bundled'; readonly path: string }
	| { readonly kind: 'remoteDownload'; readonly url: string }
	| { readonly kind: 'download'; readonly url: string; readonly cachePath: string };

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
	readonly remoteDownloadEnabled: boolean;
}

export function chooseAuraRuntimeSource(options: AuraRuntimeSourceOptions): AuraRuntimeSource {
	if (options.cacheExists) {
		return { kind: 'cache', path: options.cachePath };
	}
	if (options.bundledExists) {
		return { kind: 'bundled', path: options.bundledPath };
	}
	const downloadUrl = options.officialUrl || options.mirrorUrl;
	if (options.remoteDownloadEnabled && options.networkAvailable && downloadUrl) {
		return { kind: 'remoteDownload', url: downloadUrl };
	}
	if (options.networkAvailable && options.officialUrl) {
		return { kind: 'download', url: options.officialUrl, cachePath: options.cachePath };
	}
	if (options.networkAvailable && options.mirrorUrl) {
		return { kind: 'download', url: options.mirrorUrl, cachePath: options.cachePath };
	}
	throw new Error(`No Aura runtime source available for ${options.providerId} ${options.version} ${options.platformKey}`);
}

export async function hashAuraRuntimeFile(filePath: string): Promise<string> {
	const hash = crypto.createHash('sha256');
	const stream = fs.createReadStream(filePath);
	for await (const chunk of stream) {
		hash.update(chunk);
	}
	return hash.digest('hex');
}

export async function downloadAuraRuntime(url: string, cachePath: string): Promise<string> {
	await fs.promises.mkdir(path.dirname(cachePath), { recursive: true });
	return new Promise((resolve, reject) => {
		const request = https.get(url, response => {
			if (response.statusCode !== 200) {
				reject(new Error(`Aura runtime download failed with HTTP ${response.statusCode}`));
				response.resume();
				return;
			}
			const output = fs.createWriteStream(cachePath);
			response.pipe(output);
			output.on('finish', () => output.close(() => resolve(cachePath)));
			output.on('error', reject);
		});
		request.on('error', reject);
	});
}
