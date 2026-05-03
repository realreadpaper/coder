/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface RemoteDirectoryListing {
	readonly path: string;
	readonly directories: readonly string[];
}

const pwdMarker = '__REMOTE_AI_PWD__';

export function createListDirectoryScript(remotePath: string): string {
	return `set -eu
target=${shellQuote(remotePath)}
case "$target" in
	'~')
		target=$HOME
		;;
	'~/'*)
		target=$HOME/\${target#'~/'}
		;;
esac
if [ ! -d "$target" ]; then
	echo "Remote path is not a directory: $target" >&2
	exit 2
fi
cd "$target"
printf '${pwdMarker}%s\\n' "$(pwd -P)"
LC_ALL=C ls -1Ap | awk '/\\/$/ { sub(/\\/$/, ""); print }'
`;
}

export function parseRemoteDirectoryListing(stdout: string): RemoteDirectoryListing {
	const lines = stdout.split(/\r?\n/).filter(line => line.length > 0);
	const first = lines[0] ?? '';
	if (!first.startsWith(pwdMarker)) {
		throw new Error('Remote directory listing did not include current path marker');
	}
	return {
		path: first.slice(pwdMarker.length) || '/',
		directories: lines.slice(1).filter(name => name !== '.' && name !== '..')
	};
}

export function joinRemotePath(basePath: string, childName: string): string {
	const base = basePath === '/' ? '' : basePath.replace(/\/+$/, '');
	return `${base}/${childName}`;
}

export function parentRemotePath(remotePath: string): string {
	const normalized = remotePath.replace(/\/+$/, '') || '/';
	if (normalized === '/') {
		return '/';
	}
	const index = normalized.lastIndexOf('/');
	return index <= 0 ? '/' : normalized.slice(0, index);
}

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}
