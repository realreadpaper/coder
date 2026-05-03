/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as crypto from 'crypto';
import * as fs from 'fs';
import { AuditLogWriter } from './auditLog';
import { BootstrapResult, createBootstrapScript, parseBootstrapOutput } from './bootstrapScript';
import { sshExec, sshPipe } from './sshProcess';

export interface ServerInstallOptions {
	readonly localTarballPath?: string;
	readonly sha256?: string;
	readonly sshPath?: string;
	readonly timeoutMs?: number;
	readonly serverApplicationName?: string;
}

export interface RemoteServerInstall {
	readonly host: string;
	readonly commit: string;
	readonly platform: string;
	readonly home: string;
	readonly serverDir: string;
	readonly installed: boolean;
}

export function toRemoteServerPlatform(os: string, arch: string): string {
	return `${os}-${arch}`;
}

export async function ensureRemoteServerInstalled(
	host: string,
	commit: string,
	auditLog: AuditLogWriter,
	options: ServerInstallOptions = {}
): Promise<RemoteServerInstall> {
	await auditLog.record({
		operation: 'server.bootstrap',
		status: 'started',
		authority: `ssh-remote+${host}`,
		metadata: { commit }
	});

	let bootstrap: BootstrapResult;
	try {
		const bootstrapResult = await sshExec(host, createBootstrapScript(commit), {
			sshPath: options.sshPath,
			timeoutMs: options.timeoutMs
		});
		if (bootstrapResult.code !== 0) {
			throw new Error(formatSshFailure('bootstrap', bootstrapResult.stdout, bootstrapResult.stderr));
		}
		bootstrap = parseBootstrapOutput(bootstrapResult.stdout);
		await auditLog.record({
			operation: 'server.bootstrap',
			status: 'succeeded',
			authority: `ssh-remote+${host}`,
			metadata: { commit, os: bootstrap.os, arch: bootstrap.arch, serverPresent: bootstrap.serverPresent }
		});
	} catch (error) {
		await auditLog.record({
			operation: 'server.bootstrap',
			status: 'failed',
			authority: `ssh-remote+${host}`,
			metadata: { commit, error: String(error) }
		});
		throw error;
	}

	const platform = toRemoteServerPlatform(bootstrap.os, bootstrap.arch);
	if (bootstrap.serverPresent) {
		return {
			host,
			commit,
			platform,
			home: bootstrap.home,
			serverDir: bootstrap.serverDir,
			installed: false
		};
	}

	if (!options.localTarballPath) {
		throw new Error(`Remote server ${commit} is not installed and no local tarball was provided`);
	}

	const tarball = await fs.promises.readFile(options.localTarballPath);
	const sha256 = options.sha256 ?? hashBuffer(tarball);
	const remoteUploadPath = `${bootstrap.home}/.remote-ai-server/upload-${commit}.tar.gz`;

	await auditLog.record({
		operation: 'server.install',
		status: 'started',
		authority: `ssh-remote+${host}`,
		metadata: { commit, platform, sha256, bytes: tarball.length }
	});

	try {
		const uploadResult = await sshPipe(host, `cat > ${shellQuote(remoteUploadPath)}`, {
			input: tarball,
			sshPath: options.sshPath,
			timeoutMs: options.timeoutMs
		});
		if (uploadResult.code !== 0) {
			throw new Error(formatSshFailure('upload', uploadResult.stdout, uploadResult.stderr));
		}

		const installResult = await sshExec(host, createInstallScript({
			commit,
			platform,
			serverApplicationName: options.serverApplicationName ?? 'remote-ai-server',
			serverDir: bootstrap.serverDir,
			tmpDir: `${bootstrap.serverDir}.tmp`,
			uploadPath: remoteUploadPath,
			sha256
		}), {
			sshPath: options.sshPath,
			timeoutMs: options.timeoutMs
		});
		if (installResult.code !== 0) {
			throw new Error(formatSshFailure('install', installResult.stdout, installResult.stderr));
		}

		await auditLog.record({
			operation: 'server.install',
			status: 'succeeded',
			authority: `ssh-remote+${host}`,
			metadata: { commit, platform, sha256, serverDir: bootstrap.serverDir }
		});
	} catch (error) {
		await auditLog.record({
			operation: 'server.install',
			status: 'failed',
			authority: `ssh-remote+${host}`,
			metadata: { commit, platform, sha256, error: String(error) }
		});
		throw error;
	}

	return {
		host,
		commit,
		platform,
		home: bootstrap.home,
		serverDir: bootstrap.serverDir,
		installed: true
	};
}

interface InstallScriptOptions {
	readonly commit: string;
	readonly platform: string;
	readonly serverApplicationName: string;
	readonly serverDir: string;
	readonly tmpDir: string;
	readonly uploadPath: string;
	readonly sha256: string;
}

function createInstallScript(options: InstallScriptOptions): string {
	const marker = JSON.stringify({
		commit: options.commit,
		platform: options.platform,
		serverApplicationName: options.serverApplicationName,
		installedAt: new Date().toISOString(),
		sha256: options.sha256
	}, null, 2);

	return `set -eu
upload_path=${shellQuote(options.uploadPath)}
server_dir=${shellQuote(options.serverDir)}
tmp_dir=${shellQuote(options.tmpDir)}
expected_sha=${shellQuote(options.sha256)}
rm -rf "$tmp_dir"
mkdir -p "$tmp_dir"
if command -v sha256sum >/dev/null 2>&1; then
	actual_sha="$(sha256sum "$upload_path" | awk '{print $1}')"
elif command -v shasum >/dev/null 2>&1; then
	actual_sha="$(shasum -a 256 "$upload_path" | awk '{print $1}')"
else
	echo "remoteai-error missing-sha256-tool=sha256sum"
	exit 89
fi
if [ "$actual_sha" != "$expected_sha" ]; then
	echo "remoteai-error sha256-mismatch=$actual_sha"
	exit 87
fi
tar -xzf "$upload_path" -C "$tmp_dir"
if [ ! -x "$tmp_dir/bin/remote-ai-server" ]; then
	first_dir="$(find "$tmp_dir" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
	if [ -n "$first_dir" ] && [ -x "$first_dir/bin/remote-ai-server" ]; then
		mv "$first_dir" "$tmp_dir.contents"
		rm -rf "$tmp_dir"
		mv "$tmp_dir.contents" "$tmp_dir"
	fi
fi
if [ ! -x "$tmp_dir/bin/remote-ai-server" ]; then
	echo "remoteai-error missing-server-binary=$tmp_dir/bin/remote-ai-server"
	exit 88
fi
cat > "$tmp_dir/install-marker.json" <<'REMOTE_AI_MARKER'
${marker}
REMOTE_AI_MARKER
rm -rf "$server_dir"
mv "$tmp_dir" "$server_dir"
rm -f "$upload_path"
echo "remoteai-install=ok"
`;
}

function hashBuffer(buffer: Buffer): string {
	return crypto.createHash('sha256').update(buffer).digest('hex');
}

function formatSshFailure(phase: string, stdout: string, stderr: string): string {
	return `Remote server ${phase} failed\nstdout:\n${stdout}\nstderr:\n${stderr}`;
}

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}
