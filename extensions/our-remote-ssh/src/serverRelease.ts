/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import { RemoteAiReleaseManifest, selectTarballFromManifest } from './releaseManifest';

export interface ServerReleaseConfiguration {
	readonly serverTarballPath?: string;
	readonly serverManifestPath?: string;
	readonly commit?: string;
}

export interface ServerReleaseSearchOptions {
	readonly extensionPath: string;
	readonly appCommit?: string;
}

export interface ServerRelease {
	readonly commit: string;
	readonly tarballPath?: string;
	readonly sha256?: string;
	readonly source: 'configured-tarball' | 'configured-manifest' | 'bundled-manifest' | 'none';
}

export async function resolveServerRelease(configuration: ServerReleaseConfiguration, options: ServerReleaseSearchOptions): Promise<ServerRelease> {
	if (configuration.serverTarballPath) {
		return {
			commit: configuration.commit || '',
			tarballPath: configuration.serverTarballPath,
			source: 'configured-tarball'
		};
	}

	if (configuration.serverManifestPath) {
		return readManifestRelease(configuration.serverManifestPath, 'configured-manifest');
	}

	const bundledManifest = await findBundledServerManifest(options.extensionPath, configuration.commit, options.appCommit);
	if (bundledManifest) {
		return readManifestRelease(bundledManifest, 'bundled-manifest');
	}

	return {
		commit: configuration.commit || '',
		source: 'none'
	};
}

export function bundledServerReleaseRoots(extensionPath: string): string[] {
	return [
		path.resolve(extensionPath, '..', '..', '..', 'remote-releases'),
		path.resolve(extensionPath, '..', '..', 'remote-releases'),
		path.resolve(extensionPath, '..', '..', '.build', 'remote-ai-release', 'remote-releases')
	];
}

async function readManifestRelease(manifestPath: string, source: ServerRelease['source']): Promise<ServerRelease> {
	const manifest = JSON.parse(await fs.promises.readFile(manifestPath, 'utf8')) as RemoteAiReleaseManifest;
	const selected = selectTarballFromManifest(manifestPath, manifest);
	return {
		commit: selected.commit,
		tarballPath: selected.tarballPath,
		sha256: selected.sha256,
		source
	};
}

async function findBundledServerManifest(extensionPath: string, configuredCommit?: string, appCommit?: string): Promise<string | undefined> {
	for (const root of bundledServerReleaseRoots(extensionPath)) {
		const manifest = await findManifestInRoot(root, configuredCommit, appCommit);
		if (manifest) {
			return manifest;
		}
	}
	return undefined;
}

async function findManifestInRoot(root: string, configuredCommit?: string, appCommit?: string): Promise<string | undefined> {
	const preferredCommits = [configuredCommit, appCommit, 'dev-compat'].filter((commit): commit is string => Boolean(commit));
	for (const commit of preferredCommits) {
		const manifest = await findManifestForCommit(root, commit);
		if (manifest) {
			return manifest;
		}
	}

	let entries: fs.Dirent[];
	try {
		entries = await fs.promises.readdir(root, { withFileTypes: true });
	} catch {
		return undefined;
	}

	const manifests: string[] = [];
	for (const entry of entries) {
		if (!entry.isDirectory()) {
			continue;
		}
		const manifest = path.join(root, entry.name, 'manifest.json');
		if (await pathExists(manifest)) {
			manifests.push(manifest);
		}
	}

	return manifests.length === 1 ? manifests[0] : undefined;
}

async function findManifestForCommit(root: string, commit: string): Promise<string | undefined> {
	const exact = path.join(root, commit, 'manifest.json');
	if (await pathExists(exact)) {
		return exact;
	}

	let entries: fs.Dirent[];
	try {
		entries = await fs.promises.readdir(root, { withFileTypes: true });
	} catch {
		return undefined;
	}

	for (const entry of entries) {
		if (!entry.isDirectory()) {
			continue;
		}
		if (commit.startsWith(entry.name) || entry.name.startsWith(commit)) {
			const manifest = path.join(root, entry.name, 'manifest.json');
			if (await pathExists(manifest)) {
				return manifest;
			}
		}
	}
	return undefined;
}

async function pathExists(filePath: string): Promise<boolean> {
	try {
		await fs.promises.access(filePath);
		return true;
	} catch {
		return false;
	}
}
