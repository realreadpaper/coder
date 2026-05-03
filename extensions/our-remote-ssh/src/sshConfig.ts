/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface SshHostConfig {
	readonly host: string;
	hostName?: string;
	user?: string;
	port?: number;
	identityFile?: string;
	proxyJump?: string;
}

export function parseSshConfig(content: string): Map<string, SshHostConfig> {
	const result = new Map<string, SshHostConfig>();
	let current: SshHostConfig[] = [];

	for (const rawLine of content.split(/\r?\n/)) {
		const line = stripComment(rawLine).trim();
		if (!line) {
			continue;
		}

		const [key, ...rest] = line.split(/\s+/);
		const value = rest.join(' ');
		const lowerKey = key.toLowerCase();

		if (lowerKey === 'host') {
			current = value.split(/\s+/).filter(Boolean).map(host => ({ host }));
			for (const entry of current) {
				result.set(entry.host, entry);
			}
			continue;
		}

		for (const entry of current) {
			applySshConfigValue(entry, lowerKey, value);
		}
	}

	return result;
}

function applySshConfigValue(entry: SshHostConfig, key: string, value: string): void {
	switch (key) {
		case 'hostname':
			entry.hostName = value;
			break;
		case 'user':
			entry.user = value;
			break;
		case 'port':
			entry.port = Number(value);
			break;
		case 'identityfile':
			entry.identityFile = value;
			break;
		case 'proxyjump':
			entry.proxyJump = value;
			break;
	}
}

function stripComment(line: string): string {
	const trimmed = line.trimStart();
	if (trimmed.startsWith('#')) {
		return '';
	}
	return line;
}
