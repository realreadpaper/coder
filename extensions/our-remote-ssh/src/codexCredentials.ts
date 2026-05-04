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
python_bin=""
if command -v python3 >/dev/null 2>&1; then
	python_bin=python3
elif command -v python >/dev/null 2>&1; then
	python_bin=python
else
	echo "aura-codex-credentials-error missing-python" >&2
	exit 86
fi
"$python_bin" -c ${shellQuote(codexCredentialSyncPythonScript())} "$remote_codex_home" "$overwrite"
`;
}

function codexCredentialSyncPythonScript(): string {
	return `
import base64
import json
import os
import sys

remote_codex_home = sys.argv[1]
overwrite = sys.argv[2] == "1"
allowed = set(${JSON.stringify(codexCredentialRelativePaths)})
payload = json.loads(sys.stdin.read() or '{"files":[]}')
home_real = os.path.abspath(remote_codex_home)
written = 0
skipped = 0
for file in payload.get("files") or []:
	relative_path = file.get("relativePath")
	if relative_path not in allowed:
		raise SystemExit("unsupported credential file")
	target = os.path.abspath(os.path.join(remote_codex_home, relative_path))
	if os.path.commonpath([home_real, target]) != home_real:
		raise SystemExit("credential target escaped remote home")
	if not overwrite and os.path.exists(target):
		skipped += 1
		continue
	mode = int(file.get("mode") or 0o600)
	tmp_path = f"{target}.tmp.{os.getpid()}"
	with open(tmp_path, "wb") as handle:
		handle.write(base64.b64decode(file.get("contentBase64") or ""))
	os.chmod(tmp_path, mode)
	os.replace(tmp_path, target)
	os.chmod(target, mode)
	written += 1
print(f"aura-codex-credentials=ok written={written} skipped={skipped}")
`.trim();
}

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}
