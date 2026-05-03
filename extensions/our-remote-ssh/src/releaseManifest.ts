/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';

export interface RemoteAiReleaseManifest {
	readonly commit: string;
	readonly platform: string;
	readonly artifact: {
		readonly name: string;
		readonly sha256: string;
		readonly size: number;
	};
	readonly compatibility?: {
		readonly minGlibc?: string | null;
	};
}

export interface SelectedServerRelease {
	readonly commit: string;
	readonly tarballPath: string;
	readonly sha256: string;
}

export function selectTarballFromManifest(manifestPath: string, manifest: RemoteAiReleaseManifest): SelectedServerRelease {
	if (!/^[a-f0-9]{64}$/i.test(manifest.artifact.sha256)) {
		throw new Error('RemoteAI release manifest has invalid sha256');
	}
	return {
		commit: manifest.commit,
		tarballPath: path.join(path.dirname(manifestPath), manifest.artifact.name),
		sha256: manifest.artifact.sha256.toLowerCase()
	};
}
