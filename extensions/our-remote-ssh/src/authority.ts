/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface SshRemoteAuthority {
	readonly host: string;
}

const sshRemoteAuthorityPrefix = 'ssh-remote+';
const encodedSshRemoteAuthorityPrefixPattern = /^ssh-remote%2b/i;

export function normalizeSshRemoteAuthority(authority: string): string {
	return authority.replace(encodedSshRemoteAuthorityPrefixPattern, sshRemoteAuthorityPrefix);
}

export function parseSshRemoteAuthority(authority: string): SshRemoteAuthority {
	const normalizedAuthority = normalizeSshRemoteAuthority(authority);
	if (!normalizedAuthority.startsWith(sshRemoteAuthorityPrefix)) {
		throw new Error(`Unsupported remote authority: ${authority}`);
	}

	const encodedHost = normalizedAuthority.slice(sshRemoteAuthorityPrefix.length);
	if (!encodedHost || encodedHost.includes('/')) {
		throw new Error(`Invalid SSH remote authority: ${authority}`);
	}

	return { host: decodeURIComponent(encodedHost) };
}

export function toSshRemoteAuthority(host: string): string {
	if (!host || host.includes('/')) {
		throw new Error(`Invalid SSH host: ${host}`);
	}

	return `${sshRemoteAuthorityPrefix}${encodeURIComponent(host)}`;
}
