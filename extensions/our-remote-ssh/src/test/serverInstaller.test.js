/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('assert');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { AuditLogWriter } = require('../../out/auditLog');
const { ensureRemoteServerInstalled, toRemoteServerPlatform } = require('../../out/serverInstaller');

suite('RemoteAI server installer', () => {
	test('maps bootstrap platform to remote server platform', () => {
		assert.strictEqual(toRemoteServerPlatform('linux', 'x64'), 'linux-x64');
		assert.strictEqual(toRemoteServerPlatform('darwin', 'arm64'), 'darwin-arm64');
	});

	test('installs a synthetic server through ssh stdin and writes audit records', async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-ai-install-'));
		const fakeHome = path.join(dir, 'home');
		const packageDir = path.join(dir, 'package');
		const binDir = path.join(packageDir, 'bin');
		fs.mkdirSync(binDir, { recursive: true });
		fs.writeFileSync(path.join(binDir, 'remote-ai-server'), '#!/usr/bin/env sh\necho synthetic-server\n', { mode: 0o755 });
		fs.writeFileSync(path.join(packageDir, 'product.json'), '{"nameShort":"RemoteAI"}\n');
		fs.writeFileSync(path.join(packageDir, 'package.json'), '{"name":"remote-ai-server"}\n');

		const tarballPath = path.join(dir, 'server.tar.gz');
		cp.execFileSync('tar', ['-czf', tarballPath, '-C', packageDir, '.']);

		const sshPath = path.join(dir, 'ssh');
		const unamePath = path.join(dir, 'uname');
		fs.writeFileSync(unamePath, `#!/usr/bin/env sh
if [ "$1" = "-s" ]; then
	echo Linux
elif [ "$1" = "-m" ]; then
	echo x86_64
else
	/usr/bin/uname "$@"
fi
`, { mode: 0o755 });
		fs.writeFileSync(sshPath, `#!/usr/bin/env sh
export HOME="${fakeHome}"
export PATH="${dir}:$PATH"
if [ "$1" = "-T" ]; then
	shift
	shift
	exec "$@"
fi
shift
exec sh -c "$*"
`, { mode: 0o755 });

		const auditPath = path.join(dir, 'audit.jsonl');
		const auditLog = new AuditLogWriter(auditPath, {
			sessionId: 'install-test',
			actor: 'test'
		});

		const result = await ensureRemoteServerInstalled('dev', 'commit-1', auditLog, {
			localTarballPath: tarballPath,
			sshPath
		});

		const serverPath = path.join(fakeHome, '.remote-ai-server', 'bin', 'commit-1');
		const marker = JSON.parse(fs.readFileSync(path.join(serverPath, 'install-marker.json'), 'utf8'));
		const records = fs.readFileSync(auditPath, 'utf8').trim().split('\n').map(line => JSON.parse(line));

		assert.strictEqual(result.installed, true);
		assert.strictEqual(result.platform, 'linux-x64');
		assert.strictEqual(fs.existsSync(path.join(serverPath, 'bin', 'remote-ai-server')), true);
		assert.strictEqual(marker.commit, 'commit-1');
		assert.strictEqual(marker.platform, 'linux-x64');
		assert.deepStrictEqual(records.map(record => `${record.operation}.${record.status}`), [
			'server.bootstrap.started',
			'server.bootstrap.succeeded',
			'server.install.started',
			'server.install.succeeded'
		]);
		assert.strictEqual(records[1].previousHash, records[0].hash);
	});
});
