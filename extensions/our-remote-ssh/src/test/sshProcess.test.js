/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { getSshMultiplexingDiagnostics, sshExec } = require('../../out/sshProcess');

suite('RemoteAI SSH process', () => {
	test('passes script to OpenSSH over stdin', async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-ai-ssh-'));
		const argsPath = path.join(dir, 'ssh-args.txt');
		const sshPath = path.join(dir, 'ssh');
fs.writeFileSync(sshPath, `#!/usr/bin/env sh
cat >/tmp/remote-ai-ssh-script.txt
printf "%s\\n" "$@" > "${argsPath}"
printf "%s\\n" "host=$#:$*"
cat /tmp/remote-ai-ssh-script.txt
`, { mode: 0o755 });

		const result = await sshExec('dev', 'echo remote-ai-ok', { sshPath });
		const args = fs.readFileSync(argsPath, 'utf8').trim().split('\n');

		assert.strictEqual(result.code, 0);
		assert.ok(args.includes('ControlMaster=auto'));
		assert.ok(args.includes('ControlPersist=10m'));
		assert.ok(args.some(arg => arg.startsWith('ControlPath=')));
		const controlPath = args.find(arg => arg.startsWith('ControlPath=')).slice('ControlPath='.length);
		const controlDirMode = fs.statSync(path.dirname(controlPath)).mode & 0o777;
		assert.strictEqual(controlDirMode, 0o700);
		assert.ok(args.includes('ConnectTimeout=10'));
		assert.strictEqual(args.at(-3), 'dev');
		assert.strictEqual(args.at(-2), 'sh');
		assert.strictEqual(args.at(-1), '-s');
		assert.match(result.stdout, /echo remote-ai-ok/);
		assert.strictEqual(result.stderr, '');
	});

	test('times out hanging SSH commands', async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-ai-ssh-'));
		const sshPath = path.join(dir, 'ssh');
		fs.writeFileSync(sshPath, '#!/usr/bin/env sh\nsleep 5\n', { mode: 0o755 });

		await assert.rejects(() => sshExec('dev', 'echo never', { sshPath, timeoutMs: 10 }), /timed out/);
	});

	test('kills SSH commands that ignore timeout termination', async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-ai-ssh-'));
		const pidPath = path.join(dir, 'pid.txt');
		const sshPath = path.join(dir, 'ssh');
		fs.writeFileSync(sshPath, `#!/usr/bin/env sh
echo $$ > "${pidPath}"
trap "" TERM
while true; do sleep 1; done
`, { mode: 0o755 });

		const run = sshExec('dev', 'echo never', {
			sshPath,
			timeoutMs: 1000,
			killAfterMs: 20
		});
		await waitForFile(pidPath);
		await assert.rejects(run, /timed out/);
		const pid = Number(fs.readFileSync(pidPath, 'utf8'));

		assert.throws(() => process.kill(pid, 0), /ESRCH/);
	});

	test('stops SSH commands that exceed the output limit', async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-ai-ssh-'));
		const sshPath = path.join(dir, 'ssh');
		fs.writeFileSync(sshPath, '#!/usr/bin/env sh\nprintf "1234567890"\n', { mode: 0o755 });

		await assert.rejects(() => sshExec('dev', 'echo too-much', {
			sshPath,
			maxOutputBytes: 4
		}), /output exceeded 4 bytes/);
	});

	test('falls back without multiplexing when OpenSSH rejects ControlMaster options', async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-ai-ssh-'));
		const argsPath = path.join(dir, 'ssh-args.txt');
		const sshPath = path.join(dir, 'ssh');
		fs.writeFileSync(sshPath, `#!/usr/bin/env sh
printf "attempt\\n" >> "${argsPath}"
printf "%s\\n" "$@" >> "${argsPath}"
printf "%s\\n" "---" >> "${argsPath}"
for arg in "$@"; do
	if [ "$arg" = "ControlMaster=auto" ]; then
		echo "Bad configuration option: ControlMaster" >&2
		exit 255
	fi
done
cat >/tmp/remote-ai-ssh-fallback-script.txt
cat /tmp/remote-ai-ssh-fallback-script.txt
`, { mode: 0o755 });

		const result = await sshExec('dev', 'echo remote-ai-ok', { sshPath });
		const attempts = fs.readFileSync(argsPath, 'utf8').trim().split('\n---\n');

		assert.strictEqual(result.code, 0);
		assert.strictEqual(result.multiplexing, 'fallback');
		assert.strictEqual(attempts.length, 2);
		assert.match(attempts[0], /ControlMaster=auto/);
		assert.doesNotMatch(attempts[1], /ControlMaster=auto/);
		assert.match(result.stdout, /echo remote-ai-ok/);
	});

	test('reports multiplexing diagnostic facts', () => {
		const diagnostics = getSshMultiplexingDiagnostics();

		assert.strictEqual(diagnostics.mode, 'auto');
		assert.strictEqual(diagnostics.fallback, 'on-compatibility-error');
		assert.ok(diagnostics.controlPath.endsWith('%C'));
		assert.strictEqual(fs.statSync(diagnostics.controlDir).mode & 0o777, 0o700);
	});

	test('keeps ControlPath short enough after OpenSSH expands %C', () => {
		const diagnostics = getSshMultiplexingDiagnostics();
		const expandedControlPath = diagnostics.controlPath.replace('%C', 'a'.repeat(40));

		assert.ok(
			expandedControlPath.length < 104,
			`expanded ControlPath is too long for Unix sockets: ${expandedControlPath.length} ${expandedControlPath}`
		);
	});
});

async function waitForFile(filePath) {
	const deadline = Date.now() + 5000;
	while (Date.now() < deadline) {
		if (fs.existsSync(filePath)) {
			return;
		}
		await new Promise(resolve => setTimeout(resolve, 10));
	}
	throw new Error(`Timed out waiting for ${filePath}`);
}
