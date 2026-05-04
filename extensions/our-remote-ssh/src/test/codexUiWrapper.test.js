/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('assert');
const path = require('path');
const {
	buildCodexSshWrapperScript,
	buildUnavailableCodexSshWrapperScript,
	createCodexSshWrapperPlan,
	isManagedCodexSshWrapper
} = require('../../out/codexUiWrapper');

suite('RemoteAI Codex UI wrapper', () => {
	test('creates an SSH wrapper plan for SSH remote workspaces', () => {
		const plan = createCodexSshWrapperPlan({
			globalStoragePath: '/Users/user/Library/Application Support/Code/User/globalStorage/our.remote-ssh',
			workspaceFolderUri: {
				scheme: 'vscode-remote',
				authority: 'ssh-remote+dev',
				path: '/home/user/project'
			},
			remoteCliPath: '/home/user/.remote-ai-server/codex/0.128.0-linux-x64/bin/codex',
			sandboxMode: 'danger-full-access'
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
		assert.match(plan.script, /ssh "\$HOST" "\$cmd"/);
		assert.match(plan.script, /AURA_CODE_WORKSPACE_ROOT/);
		assert.match(plan.script, /cmd="REMOTE_PATH=\$\(quote "\$REMOTE_PATH"\); REMOTE_CODEX_CLI=\$\(quote "\$REMOTE_CODEX_CLI"\);/);
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
			sandboxMode: 'danger-full-access'
		});

		assert.strictEqual(plan, undefined);
	});

	test('quotes remote paths and CLI paths safely in the wrapper', () => {
		const script = buildCodexSshWrapperScript({
			host: 'dev box',
			remotePath: '/home/user/project\'s repo',
			remoteCliPath: '/home/user/bin/codex\'s',
			sandboxMode: 'danger-full-access'
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
			sandboxMode: 'danger-full-access'
		});

		assert.match(script, /if \[ "\$\{1:-\}" = "app-server" \]/);
		assert.ok(script.includes('exec \\"$REMOTE_CODEX_CLI\\"'));
		assert.match(script, /cmd\+=" --cd \\"\$REMOTE_PATH\\"/);
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
			sandboxMode: 'danger-full-access'
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

		assert.match(script, /exec ssh "\$HOST" "\$cmd"/);
		assert.match(script, /AURA_CODE_WORKSPACE_ROOT/);
		assert.match(script, /cmd="REMOTE_PATH=\$\(quote "\$REMOTE_PATH"\); REASON=\$\(quote "\$REASON"\);/);
		assert.match(script, /Aura Codex runtime is unavailable/);
		assert.doesNotMatch(script, /exec codex/);
		assert.doesNotMatch(script, /REMOTE_CODEX_CLI='codex'/);
	});
});
