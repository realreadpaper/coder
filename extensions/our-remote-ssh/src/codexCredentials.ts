/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface CodexCredentialSourceFile {
	readonly relativePath: string;
	readonly content: string | Buffer;
	readonly mode?: number;
}

export interface CodexCredentialPayloadFile {
	readonly relativePath: string;
	readonly contentBase64: string;
	readonly mode: number;
}

export interface CodexCredentialSyncPayload {
	readonly files: CodexCredentialPayloadFile[];
}

export interface CodexCredentialSyncScriptOptions {
	readonly remoteCodexHome: string;
	readonly overwrite: boolean;
}

export const codexCredentialRelativePaths = ['auth.json', 'config.toml'];

export function buildCodexCredentialSyncPayload(files: readonly CodexCredentialSourceFile[]): CodexCredentialSyncPayload {
	return {
		files: files.map(file => {
			if (!codexCredentialRelativePaths.includes(file.relativePath)) {
				throw new Error(`Unsupported Codex credential file: ${file.relativePath}`);
			}
			return {
				relativePath: file.relativePath,
				contentBase64: Buffer.isBuffer(file.content) ? file.content.toString('base64') : Buffer.from(file.content).toString('base64'),
				mode: file.mode ?? 0o600
			};
		})
	};
}

export function buildCodexCredentialSyncScript(options: CodexCredentialSyncScriptOptions): string {
	return `set -eu
remote_codex_home=${shellQuote(options.remoteCodexHome)}
overwrite=${shellQuote(options.overwrite ? '1' : '0')}
mkdir -p "$remote_codex_home"
node -e ${shellQuote(codexCredentialSyncNodeScript())} "$remote_codex_home" "$overwrite"
`;
}

function codexCredentialSyncNodeScript(): string {
	return `
const fs = require('fs');
const path = require('path');
const remoteCodexHome = process.argv[1];
const overwrite = process.argv[2] === '1';
const allowed = new Set(${JSON.stringify(codexCredentialRelativePaths)});
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
	const payload = JSON.parse(input || '{"files":[]}');
	let written = 0;
	let skipped = 0;
	for (const file of payload.files || []) {
		if (!allowed.has(file.relativePath)) {
			throw new Error('unsupported credential file');
		}
		const target = path.join(remoteCodexHome, file.relativePath);
		if (!overwrite && fs.existsSync(target)) {
			skipped++;
			continue;
		}
		fs.writeFileSync(target, Buffer.from(file.contentBase64, 'base64'), { mode: file.mode || 0o600 });
		fs.chmodSync(target, file.mode || 0o600);
		written++;
	}
	console.log('aura-codex-credentials=ok written=' + written + ' skipped=' + skipped);
});
`.trim();
}

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}
