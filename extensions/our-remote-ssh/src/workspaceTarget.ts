/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { normalizeSshRemoteAuthority, toSshRemoteAuthority } from './authority';

export interface WorkspaceFolderLike {
	uri: {
		scheme: string;
		authority: string;
		path: string;
	};
}

export function normalizeRemotePath(remotePath: string): string {
	if (remotePath === '~') {
		return '/';
	}
	const path = remotePath.startsWith('/') ? remotePath : `/${remotePath}`;
	return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

export function isSameRemoteWorkspace(workspaceFolders: readonly WorkspaceFolderLike[] | undefined, host: string, remotePath: string): boolean {
	const authority = toSshRemoteAuthority(host);
	const targetPath = normalizeRemotePath(remotePath);
	return Boolean(workspaceFolders?.some(folder =>
		folder.uri.scheme === 'vscode-remote'
		&& normalizeSshRemoteAuthority(folder.uri.authority) === authority
		&& normalizeRemotePath(folder.uri.path) === targetPath
	));
}
