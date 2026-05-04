/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SshHostConfig } from './sshConfig';

export interface SshHostOption {
	readonly host: string;
	readonly description?: string;
}

export interface SshHostConfigEntry {
	readonly alias: string;
	readonly content: string;
}

export const defaultSshHost = 'dev';

export function createSshHostOptions(config: Map<string, SshHostConfig>, defaultHost = defaultSshHost): SshHostOption[] {
	const options: SshHostOption[] = [];
	const seen = new Set<string>();

	for (const entry of config.values()) {
		if (isSshHostPattern(entry.host) || seen.has(entry.host)) {
			continue;
		}
		seen.add(entry.host);
		options.push({
			host: entry.host,
			description: describeSshHost(entry)
		});
	}

	options.sort((a, b) => a.host.localeCompare(b.host));

	if (defaultHost && !seen.has(defaultHost)) {
		options.push({ host: defaultHost, description: 'Default' });
	}

	return options;
}

export function isSshHostPattern(host: string): boolean {
	return /[*?\s]/.test(host);
}

function describeSshHost(entry: SshHostConfig): string | undefined {
	const target = [entry.user, entry.hostName].filter(Boolean).join('@');
	const parts = [
		entry.port && target ? `${target}:${entry.port}` : target || undefined,
		entry.port && !target ? `:${entry.port}` : undefined,
		entry.proxyJump ? `via ${entry.proxyJump}` : undefined
	].filter(Boolean);

	return parts.length ? parts.join(' ') : undefined;
}

export function createSshConfigEntry(input: string): SshHostConfigEntry {
	const value = input.trim();
	const match = /^(?:(?<user>[^@\s]+)@)?(?<host>\[[^\]\s]+\]|[^:\s]+)(?::(?<port>\d+))?$/.exec(value);
	if (!match?.groups) {
		throw new Error('Enter a host as user@host, host, or host:port.');
	}

	const user = match.groups.user;
	const rawHost = match.groups.host;
	const hostName = rawHost.startsWith('[') && rawHost.endsWith(']') ? rawHost.slice(1, -1) : rawHost;
	const port = match.groups.port;
	const lines = [
		`Host ${hostName}`,
		`  HostName ${hostName}`,
		user ? `  User ${user}` : undefined,
		port ? `  Port ${port}` : undefined
	].filter(Boolean);

	return {
		alias: hostName,
		content: `${lines.join('\n')}\n`
	};
}
