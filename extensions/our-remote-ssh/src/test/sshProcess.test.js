/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { sshExec } = require('../../out/sshProcess');

suite('RemoteAI SSH process', () => {
	test('passes script to OpenSSH over stdin', async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-ai-ssh-'));
		const sshPath = path.join(dir, 'ssh');
		fs.writeFileSync(sshPath, `#!/usr/bin/env sh
cat >/tmp/remote-ai-ssh-script.txt
printf "host=$2\\n"
cat /tmp/remote-ai-ssh-script.txt
`, { mode: 0o755 });

		const result = await sshExec('dev', 'echo remote-ai-ok', { sshPath });

		assert.strictEqual(result.code, 0);
		assert.match(result.stdout, /host=dev/);
		assert.match(result.stdout, /echo remote-ai-ok/);
		assert.strictEqual(result.stderr, '');
	});

	test('times out hanging SSH commands', async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-ai-ssh-'));
		const sshPath = path.join(dir, 'ssh');
		fs.writeFileSync(sshPath, '#!/usr/bin/env sh\nsleep 5\n', { mode: 0o755 });

		await assert.rejects(() => sshExec('dev', 'echo never', { sshPath, timeoutMs: 10 }), /timed out/);
	});
});
