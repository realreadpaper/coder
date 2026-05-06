/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('assert');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
	buildCodexSshWrapperScript,
	buildPendingCodexSshWrapperScript,
	buildUnavailableCodexSshWrapperScript,
	createCodexSshWrapperPlan,
	isManagedCodexSshWrapper
} = require('../../out/codexUiWrapper');

suite('RemoteAI Codex UI wrapper', () => {
	let tempRoot;

	setup(() => {
		tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-codex-wrapper-'));
	});

	teardown(() => {
		fs.rmSync(tempRoot, { recursive: true, force: true });
	});

	test('creates an SSH wrapper plan for SSH remote workspaces', () => {
		const plan = createCodexSshWrapperPlan({
			globalStoragePath: '/Users/user/Library/Application Support/Code/User/globalStorage/our.remote-ssh',
			workspaceFolderUri: {
				scheme: 'vscode-remote',
				authority: 'ssh-remote+dev',
				path: '/home/user/project'
			},
			remoteCliPath: '/home/user/.remote-ai-server/codex/0.128.0-linux-x64/bin/codex',
			sandboxMode: 'danger-full-access',
			bypassApprovalsAndSandbox: false
		});

		assert.ok(plan);
		assert.strictEqual(plan.host, 'dev');
		assert.strictEqual(plan.remotePath, '/home/user/project');
		assert.strictEqual(plan.remoteCliPath, '/home/user/.remote-ai-server/codex/0.128.0-linux-x64/bin/codex');
		assert.strictEqual(plan.wrapperPath, path.join(
			'/Users/user/Library/Application Support/Code/User/globalStorage/our.remote-ssh',
			'codex-ui',
			'aura-code-codex-ssh-dev'
		));
		assert.match(plan.script, /env -u LC_ALL -u LC_CTYPE LANG=C ssh -T "\$HOST" "\$cmd"/);
		assert.match(plan.script, /export LC_ALL=C; export LANG=C; export LC_CTYPE=C;/);
		assert.match(plan.script, /AURA_CODE_WORKSPACE_ROOT/);
		assert.match(plan.script, /EXPECTED_AURA_CODE_WORKSPACE_ROOT/);
		assert.match(plan.script, /AURA_CODE_REMOTE_AUTHORITY/);
		assert.match(plan.script, /cmd="export LC_ALL=C; export LANG=C; export LC_CTYPE=C; REMOTE_PATH=\$\(quote "\$REMOTE_PATH"\); REMOTE_CODEX_CLI=\$\(quote "\$REMOTE_CODEX_CLI"\);/);
		assert.match(plan.script, /--cd/);
	});

	test('does not create a wrapper plan for local file workspaces', () => {
		const plan = createCodexSshWrapperPlan({
			globalStoragePath: '/Users/user/state',
			workspaceFolderUri: {
				scheme: 'file',
				authority: '',
				path: '/Users/user/project'
			},
			remoteCliPath: '/home/user/codex',
			sandboxMode: 'danger-full-access',
			bypassApprovalsAndSandbox: false
		});

		assert.strictEqual(plan, undefined);
	});

	test('creates a wrapper plan when the ssh separator is URI encoded', () => {
		const plan = createCodexSshWrapperPlan({
			globalStoragePath: '/Users/user/state',
			workspaceFolderUri: {
				scheme: 'vscode-remote',
				authority: 'ssh-remote%2Bdev',
				path: '/home/user/project'
			},
			remoteCliPath: '/home/user/bin/codex',
			sandboxMode: 'danger-full-access',
			bypassApprovalsAndSandbox: false
		});

		assert.ok(plan);
		assert.strictEqual(plan.host, 'dev');
		assert.strictEqual(plan.remotePath, '/home/user/project');
	});

	test('quotes remote paths and CLI paths safely in the wrapper', () => {
		const script = buildCodexSshWrapperScript({
			host: 'dev box',
			remotePath: '/home/user/project\'s repo',
			remoteCliPath: '/home/user/bin/codex\'s',
			sandboxMode: 'danger-full-access',
			bypassApprovalsAndSandbox: false
		});

		assert.match(script, /HOST='dev box'/);
		assert.match(script, /REMOTE_PATH='\/home\/user\/project'\\''s repo'/);
		assert.match(script, /REMOTE_CODEX_CLI='\/home\/user\/bin\/codex'\\''s'/);
	});

	test('does not inject exec-only flags when OpenAI starts the app-server', () => {
		const script = buildCodexSshWrapperScript({
			host: 'dev',
			remotePath: '/home/user/project',
			remoteCliPath: '/home/user/bin/codex',
			sandboxMode: 'danger-full-access',
			bypassApprovalsAndSandbox: false
		});

		assert.match(script, /if \[ "\$\{1:-\}" = "app-server" \]/);
		assert.ok(script.includes('exec \\"$REMOTE_CODEX_CLI\\"'));
		assert.match(script, /cmd\+=" --cd \\"\$REMOTE_PATH\\"/);
		assert.match(script, /BYPASS_APPROVALS_AND_SANDBOX='0'/);
		assert.match(script, /if \[ "\$BYPASS_APPROVALS_AND_SANDBOX" = "1" \]/);
	});

	test('does not expand unset workspace identity variables while building the remote command', () => {
		const script = buildCodexSshWrapperScript({
			host: 'dev',
			remotePath: '/home/user/project',
			remoteCliPath: '/home/user/bin/codex',
			sandboxMode: 'danger-full-access',
			bypassApprovalsAndSandbox: false
		});

		assert.doesNotMatch(script, /export AURA_CODE_REMOTE_AUTHORITY=\\?"?\$AURA_CODE_REMOTE_AUTHORITY/);
		assert.match(script, /export AURA_CODE_REMOTE_AUTHORITY=\\?"?\$EXPECTED_AURA_CODE_REMOTE_AUTHORITY/);
	});

	test('executes app-server wrapper without local workspace identity variables', () => {
		const result = runWrapperWithFakeSsh(tempRoot, buildCodexSshWrapperScript({
			host: 'dev',
			remotePath: '/home/user/project',
			remoteCliPath: '/home/user/bin/codex',
			sandboxMode: 'danger-full-access',
			bypassApprovalsAndSandbox: false
		}), ['app-server']);

		assert.strictEqual(result.status, 0, result.stderr);
		assert.strictEqual(result.sshArgs[0], '-T');
		assert.strictEqual(result.sshArgs[1], 'dev');
		assert.match(result.sshArgs[2], /export LC_ALL=C; export LANG=C; export LC_CTYPE=C;/);
		assert.match(result.sshArgs[2], /export AURA_CODE_REMOTE_AUTHORITY="ssh-remote\+dev"/);
		assert.match(result.sshArgs[2], /exec "\/home\/user\/bin\/codex" app-server/);
		assert.doesNotMatch(result.sshArgs[2], /--cd/);
	});

	test('executes non app-server wrapper with sandbox flags only after the remote command', () => {
		const result = runWrapperWithFakeSsh(tempRoot, buildCodexSshWrapperScript({
			host: 'dev',
			remotePath: '/home/user/project',
			remoteCliPath: '/home/user/bin/codex',
			sandboxMode: 'workspace-write',
			bypassApprovalsAndSandbox: true
		}), ['exec', 'echo ok']);

		assert.strictEqual(result.status, 0, result.stderr);
		assert.strictEqual(result.sshArgs[0], '-T');
		assert.strictEqual(result.sshArgs[1], 'dev');
		assert.match(result.sshArgs[2], /export LC_ALL=C; export LANG=C; export LC_CTYPE=C;/);
		assert.match(result.sshArgs[2], /exec "\/home\/user\/bin\/codex" --cd "\/home\/user\/project" --sandbox workspace-write --dangerously-bypass-approvals-and-sandbox exec echo\\ ok/);
	});

	test('executes unavailable wrapper without local workspace identity variables', () => {
		const result = runWrapperWithFakeSsh(tempRoot, buildUnavailableCodexSshWrapperScript({
			host: 'dev',
			remotePath: '/home/user/project',
			reason: 'runtime failed'
		}), []);

		assert.strictEqual(result.status, 0, result.stderr);
		assert.strictEqual(result.sshArgs[0], '-T');
		assert.strictEqual(result.sshArgs[1], 'dev');
		assert.match(result.sshArgs[2], /export LC_ALL=C; export LANG=C; export LC_CTYPE=C;/);
		assert.match(result.sshArgs[2], /export AURA_CODE_REMOTE_AUTHORITY="ssh-remote\+dev"/);
		assert.match(result.sshArgs[2], /Aura Codex runtime is unavailable: runtime failed/);
	});

	test('only bypasses approvals and sandbox when explicitly requested', () => {
		const script = buildCodexSshWrapperScript({
			host: 'dev',
			remotePath: '/home/user/project',
			remoteCliPath: '/home/user/bin/codex',
			sandboxMode: 'danger-full-access',
			bypassApprovalsAndSandbox: true
		});

		assert.match(script, /--dangerously-bypass-approvals-and-sandbox/);
	});

	test('can generate a pending wrapper while runtime binding is still preparing', () => {
		const script = buildPendingCodexSshWrapperScript({
			host: 'dev',
			remotePath: '/home/user/project'
		});

		assert.match(script, /Aura Codex runtime is still preparing/);
		assert.match(script, /HOST='dev'/);
		assert.match(script, /REMOTE_PATH='\/home\/user\/project'/);
		assert.doesNotMatch(script, /exec codex/);
		assert.doesNotMatch(script, /REMOTE_CODEX_CLI='codex'/);
	});

	test('rejects execution when workspace identity environment belongs to another SSH window', () => {
		const script = buildCodexSshWrapperScript({
			host: 'dev',
			remotePath: '/home/user/project',
			remoteCliPath: '/home/user/bin/codex',
			sandboxMode: 'danger-full-access',
			bypassApprovalsAndSandbox: false
		});

		assert.match(script, /EXPECTED_AURA_CODE_REMOTE_AUTHORITY='ssh-remote\+dev'/);
		assert.match(script, /AURA_CODE_REMOTE_AUTHORITY mismatch/);
		assert.match(script, /AURA_CODE_WORKSPACE_ROOT mismatch/);
	});

	test('recognizes only RemoteAI managed wrapper paths', () => {
		assert.strictEqual(isManagedCodexSshWrapper('/tmp/state/codex-ui/aura-code-codex-ssh-dev'), true);
		assert.strictEqual(isManagedCodexSshWrapper('/tmp/state/codex-ui/remote-ai-codex-ssh-dev'), true);
		assert.strictEqual(isManagedCodexSshWrapper('/tmp/state/remote-ai-codex-ssh-dev'), true);
		assert.strictEqual(isManagedCodexSshWrapper('/usr/local/bin/codex'), false);
	});

	test('uses Aura Code wrapper path while recognizing legacy wrapper paths', () => {
		const plan = createCodexSshWrapperPlan({
			globalStoragePath: '/Users/user/state',
			workspaceFolderUri: {
				scheme: 'vscode-remote',
				authority: 'ssh-remote+dev',
				path: '/home/user/project'
			},
			remoteCliPath: '/home/user/.aura-code/runtimes/codex/0.128.0-linux-x64/bin/codex',
			sandboxMode: 'danger-full-access',
			bypassApprovalsAndSandbox: false
		});
		assert.ok(plan.wrapperPath.endsWith('/codex-ui/aura-code-codex-ssh-dev'));
		assert.strictEqual(isManagedCodexSshWrapper('/tmp/codex-ui/aura-code-codex-ssh-dev'), true);
		assert.strictEqual(isManagedCodexSshWrapper('/tmp/codex-ui/remote-ai-codex-ssh-dev'), true);
	});

	test('can generate a remote-only blocking wrapper when runtime binding fails', () => {
		const script = buildUnavailableCodexSshWrapperScript({
			host: 'dev',
			remotePath: '/home/user/project',
			reason: 'runtime probe failed'
		});

		assert.match(script, /exec env -u LC_ALL -u LC_CTYPE LANG=C ssh -T "\$HOST" "\$cmd"/);
		assert.match(script, /export LC_ALL=C; export LANG=C; export LC_CTYPE=C;/);
		assert.match(script, /AURA_CODE_WORKSPACE_ROOT/);
		assert.match(script, /cmd="export LC_ALL=C; export LANG=C; export LC_CTYPE=C; REMOTE_PATH=\$\(quote "\$REMOTE_PATH"\); REASON=\$\(quote "\$REASON"\);/);
		assert.match(script, /Aura Codex runtime is unavailable/);
		assert.doesNotMatch(script, /exec codex/);
		assert.doesNotMatch(script, /REMOTE_CODEX_CLI='codex'/);
	});
});

function runWrapperWithFakeSsh(tempRoot, script, args) {
	const binDir = path.join(tempRoot, 'bin');
	const capturePath = path.join(tempRoot, 'ssh-args.json');
	const wrapperPath = path.join(tempRoot, 'wrapper');
	fs.mkdirSync(binDir, { recursive: true });
	fs.writeFileSync(path.join(binDir, 'ssh'), `#!/usr/bin/env bash
node -e 'require("fs").writeFileSync(process.env.CAPTURE_PATH, JSON.stringify(process.argv.slice(1)))' -- "$@"
`, { mode: 0o755 });
	fs.writeFileSync(wrapperPath, script, { mode: 0o755 });
	const result = cp.spawnSync(wrapperPath, args, {
		encoding: 'utf8',
		env: {
			CAPTURE_PATH: capturePath,
			HOME: process.env.HOME,
			PATH: `${binDir}${path.delimiter}${process.env.PATH}`
		}
	});
	return {
		status: result.status,
		stderr: result.stderr,
		stdout: result.stdout,
		sshArgs: fs.existsSync(capturePath) ? JSON.parse(fs.readFileSync(capturePath, 'utf8')) : []
	};
}
