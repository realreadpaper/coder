# Remote Codex Native Workspace 实施计划

> **给 agentic workers：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 按任务实施此计划。步骤使用 checkbox（`- [ ]`）语法跟踪进度。

**目标：** 删除 AI agent 本地 mirror/rsync 执行模式，让远程工作区中的 Codex 任务直接在 Remote Extension Host 和远程真实目录中执行。

**架构：** 保留现有 `our.remote-ssh` resolver 和 RemoteAI Server 链路。`ai-codex-remote-bridge` 在 `vscode.env.remoteName` 存在时走新的 `remoteCodexRunner`，使用远程 workspace `fsPath`、远程 Linux Codex CLI 和远程 cwd；本地 workspace 仍走本地 runner。生产代码中移除 `localRemoteCodexRunner`、rsync 参数构造和 local mirror root。

**技术栈：** Code-OSS extension host、TypeScript、Node.js `child_process`、Mocha TDD tests、RemoteAI existing `codexTaskRunner` / `codexCliInstaller`。

---

## 文件结构

新增：

- `extensions/ai-codex-remote-bridge/src/remoteCodexRunner.ts`  
  远程 Codex 执行入口。只负责远程 workspace root、远程 Codex CLI 路径、输出路径和调用 `runCodexWorkspaceTask`。

- `extensions/ai-codex-remote-bridge/src/test/remoteCodexRunner.test.js`  
  验证远程 runner 的路径、CLI 选择、错误和 `runCodexWorkspaceTask` 参数。

修改：

- `extensions/ai-codex-remote-bridge/src/extension.ts`  
  删除 `parseSshRemoteWorkspace` / `runLocalCodexRemoteWorkspaceTask` 分支。remote workspace 下调用 `runRemoteWorkspaceTask`。

- `extensions/ai-codex-remote-bridge/package.json`  
  删除 `remoteai.codex.executionMode`。保留 `remoteai.codex.localCliPath` 但描述为仅本地 workspace 使用。新增 `remoteai.codex.remoteCliPath`。

- `extensions/ai-codex-remote-bridge/src/test/codexTaskRunner.test.js`  
  调整含 macOS/local 字样的测试名称，避免把本地状态目录表述成远程主路径。

- `docs/remote-ai-basic-usage.md`  
  删除或改写任何把 local mirror/rsync 作为远程 Codex 主链路的描述。

- `docs/remote-ai-validation-steps.md`  
  验证步骤改为远程 Codex CLI 和远程 `.remote-ai-codex/last-message.md`。

删除：

- `extensions/ai-codex-remote-bridge/src/localRemoteCodexRunner.ts`
- `extensions/ai-codex-remote-bridge/src/test/localRemoteCodexRunner.test.js`

不修改：

- `extensions/our-remote-ssh/**`
- `src/vs/platform/remote/**`
- `src/vs/workbench/services/remote/**`

## Task 1: 用测试锁定远程 runner 行为

**Files:**
- 新建：`extensions/ai-codex-remote-bridge/src/test/remoteCodexRunner.test.js`
- 新建：`extensions/ai-codex-remote-bridge/src/remoteCodexRunner.ts`

- [ ] **步骤 1：写失败测试**

创建 `extensions/ai-codex-remote-bridge/src/test/remoteCodexRunner.test.js`：

```js
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('assert');
const path = require('path');
const {
	createRemoteCodexTaskPlan,
	defaultRemoteCodexStateRoot,
	resolveRemoteCodexPath
} = require('../../out/remoteCodexRunner');

suite('Remote Codex runner', () => {
	test('builds a remote workspace task plan rooted in the remote workspace', () => {
		const plan = createRemoteCodexTaskPlan({
			workspaceRoot: '/home/user/project',
			prompt: 'Append a smoke line',
			sandboxMode: 'workspace-write',
			remoteCliPath: '/home/user/.remote-ai-server/User/globalStorage/our.ai-codex-remote-bridge/codex-cli/0.128.0-linux-x64/bin/codex',
			globalStoragePath: '/home/user/.remote-ai-server/User/globalStorage/our.ai-codex-remote-bridge'
		});

		assert.strictEqual(plan.codexPath, '/home/user/.remote-ai-server/User/globalStorage/our.ai-codex-remote-bridge/codex-cli/0.128.0-linux-x64/bin/codex');
		assert.strictEqual(plan.workspaceRoot, '/home/user/project');
		assert.strictEqual(plan.outputLastMessagePath, '/home/user/project/.remote-ai-codex/last-message.md');
		assert.deepStrictEqual(plan.additionalWritableRoots, [
			'/home/user/.remote-ai-server/User/globalStorage/our.ai-codex-remote-bridge'
		]);
	});

	test('uses configured remote CLI path before installer path', () => {
		const codexPath = resolveRemoteCodexPath({
			remoteCliPath: '/opt/codex/bin/codex',
			globalStoragePath: '/home/user/.remote-ai-server/User/globalStorage/our.ai-codex-remote-bridge',
			platform: 'linux',
			arch: 'x64'
		});

		assert.strictEqual(codexPath, '/opt/codex/bin/codex');
	});

	test('uses Linux installer path when remote CLI path is empty', () => {
		const codexPath = resolveRemoteCodexPath({
			remoteCliPath: '',
			globalStoragePath: '/home/user/.remote-ai-server/User/globalStorage/our.ai-codex-remote-bridge',
			platform: 'linux',
			arch: 'x64'
		});

		assert.strictEqual(codexPath, '/home/user/.remote-ai-server/User/globalStorage/our.ai-codex-remote-bridge/codex-cli/0.128.0-linux-x64/bin/codex');
	});

	test('rejects non-Linux remote platforms', () => {
		assert.throws(() => resolveRemoteCodexPath({
			remoteCliPath: '',
			globalStoragePath: '/Users/user/Library/Application Support/RemoteAI',
			platform: 'darwin',
			arch: 'arm64'
		}), /Remote Codex CLI must be Linux/);
	});

	test('uses a remote-side Codex state root', () => {
		assert.strictEqual(
			defaultRemoteCodexStateRoot('/home/user/.remote-ai-server/User/globalStorage/our.ai-codex-remote-bridge'),
			'/home/user/.remote-ai-server/User/globalStorage/our.ai-codex-remote-bridge'
		);
	});

	test('does not expose rsync or local mirror concepts', () => {
		const sourcePath = path.join(__dirname, '../../out/remoteCodexRunner.js');
		const source = require('fs').readFileSync(sourcePath, 'utf8');
		assert.doesNotMatch(source, /rsync|local-remote-workspaces|local mirror|runLocalCodexRemoteWorkspaceTask/);
	});
});
```

- [ ] **步骤 2：创建最小导出文件，让测试能加载但先失败在断言**

创建 `extensions/ai-codex-remote-bridge/src/remoteCodexRunner.ts`：

```ts
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export function resolveRemoteCodexPath(): string {
	return '';
}

export function defaultRemoteCodexStateRoot(): string {
	return '';
}

export function createRemoteCodexTaskPlan(): unknown {
	return {};
}
```

- [ ] **步骤 3：编译 bridge，确认测试失败**

运行：

```bash
node ./node_modules/gulp/bin/gulp.js compile-extension:ai-codex-remote-bridge
npx mocha --timeout 10000 --ui=tdd extensions/ai-codex-remote-bridge/src/test/remoteCodexRunner.test.js
```

预期：编译通过，Mocha 失败，错误包含：

```text
AssertionError
actual: ''
expected: '/opt/codex/bin/codex'
```

- [ ] **步骤 4：提交失败测试和 stub**

```bash
git add extensions/ai-codex-remote-bridge/src/test/remoteCodexRunner.test.js extensions/ai-codex-remote-bridge/src/remoteCodexRunner.ts
git commit -m "test: cover native remote codex runner"
```

## Task 2: 实现远程 Codex runner

**Files:**
- 修改：`extensions/ai-codex-remote-bridge/src/remoteCodexRunner.ts`
- 测试：`extensions/ai-codex-remote-bridge/src/test/remoteCodexRunner.test.js`

- [ ] **步骤 1：实现路径规划和远程执行函数**

替换 `extensions/ai-codex-remote-bridge/src/remoteCodexRunner.ts` 内容：

```ts
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import { createCodexCliInstallPlan } from './codexCliInstaller';
import { CodexTaskResult, runCodexWorkspaceTask } from './codexTaskRunner';

export interface RemoteCodexPathOptions {
	readonly remoteCliPath?: string;
	readonly globalStoragePath: string;
	readonly platform?: NodeJS.Platform;
	readonly arch?: string;
}

export interface RemoteCodexTaskPlan {
	readonly codexPath: string;
	readonly workspaceRoot: string;
	readonly prompt: string;
	readonly sandboxMode: 'read-only' | 'workspace-write' | 'danger-full-access';
	readonly outputLastMessagePath: string;
	readonly additionalWritableRoots: readonly string[];
}

export interface RemoteCodexTaskOptions extends RemoteCodexPathOptions {
	readonly workspaceRoot: string;
	readonly prompt: string;
	readonly sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access';
	readonly outputLastMessagePath?: string;
}

export function resolveRemoteCodexPath(options: RemoteCodexPathOptions): string {
	const configured = options.remoteCliPath?.trim();
	if (configured) {
		return configured;
	}
	return createCodexCliInstallPlan(
		options.globalStoragePath,
		options.platform ?? process.platform,
		options.arch ?? process.arch
	).binPath;
}

export function defaultRemoteCodexStateRoot(globalStoragePath: string): string {
	return toPosix(globalStoragePath);
}

export function createRemoteCodexTaskPlan(options: RemoteCodexTaskOptions): RemoteCodexTaskPlan {
	const workspaceRoot = toPosix(options.workspaceRoot);
	const outputLastMessagePath = options.outputLastMessagePath
		? toPosix(options.outputLastMessagePath)
		: path.posix.join(workspaceRoot, '.remote-ai-codex', 'last-message.md');
	return {
		codexPath: resolveRemoteCodexPath(options),
		workspaceRoot,
		prompt: options.prompt,
		sandboxMode: options.sandboxMode ?? 'danger-full-access',
		outputLastMessagePath,
		additionalWritableRoots: [defaultRemoteCodexStateRoot(options.globalStoragePath)]
	};
}

export async function runRemoteCodexWorkspaceTask(options: RemoteCodexTaskOptions): Promise<CodexTaskResult> {
	const plan = createRemoteCodexTaskPlan(options);
	await fs.promises.mkdir(path.posix.dirname(plan.outputLastMessagePath), { recursive: true });
	return runCodexWorkspaceTask({
		codexPath: plan.codexPath,
		workspaceRoot: plan.workspaceRoot,
		prompt: plan.prompt,
		sandboxMode: plan.sandboxMode,
		additionalWritableRoots: plan.additionalWritableRoots,
		outputLastMessagePath: plan.outputLastMessagePath
	});
}

function toPosix(value: string): string {
	return value.replace(/\\/g, '/');
}
```

- [ ] **步骤 2：运行远程 runner 测试，确认通过**

运行：

```bash
node ./node_modules/gulp/bin/gulp.js compile-extension:ai-codex-remote-bridge
npx mocha --timeout 10000 --ui=tdd extensions/ai-codex-remote-bridge/src/test/remoteCodexRunner.test.js
```

预期：

```text
6 passing
```

- [ ] **步骤 3：运行 Codex runner 相关测试，确认没有回归**

运行：

```bash
npx mocha --timeout 10000 --ui=tdd \
  extensions/ai-codex-remote-bridge/src/test/codexTaskRunner.test.js \
  extensions/ai-codex-remote-bridge/src/test/codexCliInstaller.test.js \
  extensions/ai-codex-remote-bridge/src/test/remoteCodexRunner.test.js
```

预期：全部 passing。

- [ ] **步骤 4：提交实现**

```bash
git add extensions/ai-codex-remote-bridge/src/remoteCodexRunner.ts extensions/ai-codex-remote-bridge/src/test/remoteCodexRunner.test.js
git commit -m "feat: run codex tasks in remote workspace"
```

## Task 3: 切换 command 分支到远程原生执行

**Files:**
- 修改：`extensions/ai-codex-remote-bridge/src/extension.ts`

- [ ] **步骤 1：更新 import**

在 `extensions/ai-codex-remote-bridge/src/extension.ts` 中删除：

```ts
import { createLocalMirrorRoot, parseSshRemoteWorkspace, runLocalCodexRemoteWorkspaceTask } from './localRemoteCodexRunner';
```

加入：

```ts
import { runRemoteCodexWorkspaceTask } from './remoteCodexRunner';
```

- [ ] **步骤 2：替换 `remoteai.codex.runTask` 分支**

把命令里的这段：

```ts
const configuration = vscode.workspace.getConfiguration('remoteai.codex');
const configured = configuration.get<string>('localCliPath') || 'codex';
const sandboxMode = configuration.get<'read-only' | 'workspace-write' | 'danger-full-access'>('sandboxMode') || 'danger-full-access';
const remoteWorkspace = parseSshRemoteWorkspace(folder.uri);
const result = remoteWorkspace
	? await runLocalRemoteTask(context, output, configured, sandboxMode, remoteWorkspace, prompt)
	: await runLocalWorkspaceTask(output, configured, sandboxMode, root, prompt);
```

替换为：

```ts
const configuration = vscode.workspace.getConfiguration('remoteai.codex');
const sandboxMode = configuration.get<'read-only' | 'workspace-write' | 'danger-full-access'>('sandboxMode') || 'danger-full-access';
const result = vscode.env.remoteName
	? await runRemoteWorkspaceTask(context, output, configuration, sandboxMode, root, prompt)
	: await runLocalWorkspaceTask(output, configuration.get<string>('localCliPath') || 'codex', sandboxMode, root, prompt);
```

- [ ] **步骤 3：删除 `runLocalRemoteTask` helper，新增远程 helper**

删除文件底部的 `runLocalRemoteTask` 函数。

加入：

```ts
async function runRemoteWorkspaceTask(
	context: vscode.ExtensionContext,
	output: vscode.OutputChannel,
	configuration: vscode.WorkspaceConfiguration,
	sandboxMode: 'read-only' | 'workspace-write' | 'danger-full-access',
	root: string,
	prompt: string
) {
	const remoteCliPath = configuration.get<string>('remoteCliPath') || '';
	output.appendLine(`Running remote Codex task in ${root}`);
	output.appendLine(remoteCliPath ? `Remote Codex CLI: ${remoteCliPath}` : 'Remote Codex CLI: managed Linux install path');
	return runRemoteCodexWorkspaceTask({
		remoteCliPath,
		globalStoragePath: context.globalStorageUri.fsPath,
		workspaceRoot: root,
		prompt,
		sandboxMode
	});
}
```

- [ ] **步骤 4：编译确认 TypeScript 通过**

运行：

```bash
node ./node_modules/gulp/bin/gulp.js compile-extension:ai-codex-remote-bridge
```

预期：命令退出码 0，没有 `Cannot find name`、`Module not found` 或 TypeScript error。

- [ ] **步骤 5：提交 command 分支切换**

```bash
git add extensions/ai-codex-remote-bridge/src/extension.ts
git commit -m "feat: route remote codex tasks to remote host"
```

## Task 4: 更新配置，删除 mirror 模式入口

**Files:**
- 修改：`extensions/ai-codex-remote-bridge/package.json`

- [ ] **步骤 1：修改配置 schema**

在 `extensions/ai-codex-remote-bridge/package.json` 中删除整个 `remoteai.codex.executionMode` 属性。

把 `remoteai.codex.localCliPath.description` 改为：

```json
"Local Codex CLI path used only for non-remote workspaces. Leave empty to resolve codex from the local PATH."
```

新增：

```json
"remoteai.codex.remoteCliPath": {
	"type": "string",
	"default": "",
	"description": "Remote Linux Codex CLI path used when this extension runs in a RemoteAI SSH workspace. Leave empty to use the managed remote Linux install path."
}
```

把 `remoteai.codex.sandboxMode.description` 改为：

```json
"Sandbox mode used by the Codex process in the current workspace execution host."
```

- [ ] **步骤 2：编译 extension manifest**

运行：

```bash
node ./node_modules/gulp/bin/gulp.js compile-extension:ai-codex-remote-bridge
```

预期：退出码 0。

- [ ] **步骤 3：检查旧配置不存在**

运行：

```bash
rg -n "remoteai\\.codex\\.executionMode|synchronizes changes|local mirror" extensions/ai-codex-remote-bridge/package.json
```

预期：无输出，退出码 1。

- [ ] **步骤 4：提交配置变更**

```bash
git add extensions/ai-codex-remote-bridge/package.json
git commit -m "chore: remove codex mirror execution setting"
```

## Task 5: 删除 local mirror/rsync 生产代码和测试

**Files:**
- 删除：`extensions/ai-codex-remote-bridge/src/localRemoteCodexRunner.ts`
- 删除：`extensions/ai-codex-remote-bridge/src/test/localRemoteCodexRunner.test.js`
- 修改：`extensions/ai-codex-remote-bridge/src/test/codexTaskRunner.test.js`

- [ ] **步骤 1：删除旧 runner 和测试**

运行：

```bash
git rm extensions/ai-codex-remote-bridge/src/localRemoteCodexRunner.ts \
  extensions/ai-codex-remote-bridge/src/test/localRemoteCodexRunner.test.js
```

预期：

```text
rm 'extensions/ai-codex-remote-bridge/src/localRemoteCodexRunner.ts'
rm 'extensions/ai-codex-remote-bridge/src/test/localRemoteCodexRunner.test.js'
```

- [ ] **步骤 2：调整 Codex task runner 测试名称**

在 `extensions/ai-codex-remote-bridge/src/test/codexTaskRunner.test.js` 中把：

```js
test('adds extra writable roots for workspace-write sandbox on macOS', () => {
```

改为：

```js
test('adds extra writable roots for workspace-write sandbox', () => {
```

测试内容不变。

- [ ] **步骤 3：编译并运行 bridge 测试**

运行：

```bash
node ./node_modules/gulp/bin/gulp.js compile-extension:ai-codex-remote-bridge
npx mocha --timeout 10000 --ui=tdd extensions/ai-codex-remote-bridge/src/test/*.test.js
```

预期：全部 passing。测试列表中不再包含 `localRemoteCodexRunner.test.js`。

- [ ] **步骤 4：静态检查生产代码不再引用旧模式**

运行：

```bash
rg -n "localRemoteCodexRunner|runLocalCodexRemoteWorkspaceTask|createLocalMirrorRoot|buildRsyncPullArgs|buildRsyncPushArgs|local-remote-workspaces" extensions/ai-codex-remote-bridge/src extensions/ai-codex-remote-bridge/package.json
```

预期：无输出，退出码 1。

运行：

```bash
rg -n "rsync" extensions/ai-codex-remote-bridge/src extensions/ai-codex-remote-bridge/package.json
```

预期：无输出，退出码 1。

- [ ] **步骤 5：提交删除旧模式**

```bash
git add extensions/ai-codex-remote-bridge/src/test/codexTaskRunner.test.js
git commit -m "refactor: remove codex local mirror runner"
```

## Task 6: 更新文档和验证脚本期望

**Files:**
- 修改：`docs/remote-ai-basic-usage.md`
- 修改：`docs/remote-ai-validation-steps.md`
- 修改：`test/remote-ai/e2e/remoteAiFullE2E.js`

- [ ] **步骤 1：更新 basic usage 的 Codex 描述**

在 `docs/remote-ai-basic-usage.md` 的 `Codex Extension Support` 段落中，确保包含：

```markdown
RemoteAI runs Codex tasks directly in the workspace execution host:

- Local workspaces use the local Codex CLI and local filesystem.
- RemoteAI SSH workspaces use the Remote Extension Host, remote Linux Codex CLI, and remote workspace filesystem.
- The previous local mirror plus rsync execution path is removed from production code.
```

并删除任何表示“local mirror 是 SSH 远程工作区主执行路径”的句子。

- [ ] **步骤 2：更新 validation steps 的远程验收**

在 `docs/remote-ai-validation-steps.md` 的 Codex 验收段落中加入：

```text
远程 Codex 验收必须确认：

ssh dev 'test -f /home/hejianglong/remote-ai-manual/.remote-ai-codex/last-message.md'
ssh dev 'cd /home/hejianglong/remote-ai-manual && git diff -- .'

本机源码目录不应出现由远程 Codex 任务生成的业务文件。生产代码中也不应出现 `localRemoteCodexRunner` 或 `rsync` 作为 Codex 执行路径。
```

- [ ] **步骤 3：更新 E2E 静态断言**

在 `test/remote-ai/e2e/remoteAiFullE2E.js` 中加入静态检查函数：

```js
function assertNoLocalMirrorCodexPath(repoRoot) {
	const bridgeSrc = path.join(repoRoot, 'extensions/ai-codex-remote-bridge/src');
	const result = cp.spawnSync('rg', [
		'-n',
		'localRemoteCodexRunner|runLocalCodexRemoteWorkspaceTask|local-remote-workspaces|buildRsyncPullArgs|buildRsyncPushArgs',
		bridgeSrc
	], { encoding: 'utf8' });
	if (result.status === 0) {
		throw new Error(`Codex local mirror path still exists:\n${result.stdout}`);
	}
	if (result.status !== 1) {
		throw new Error(`rg failed while checking Codex mirror removal:\n${result.stderr}`);
	}
}
```

在主流程早期调用：

```js
assertNoLocalMirrorCodexPath(repoRoot);
```

- [ ] **步骤 4：运行文档和 E2E 静态检查**

运行：

```bash
node test/remote-ai/e2e/remoteAiFullE2E.js --help
rg -n "localRemoteCodexRunner|local-remote-workspaces|runLocalCodexRemoteWorkspaceTask" docs/remote-ai-basic-usage.md docs/remote-ai-validation-steps.md test/remote-ai/e2e/remoteAiFullE2E.js
```

预期：

- 第一个命令不因语法错误退出。
- 第二个命令无输出，退出码 1，除非命中的是明确说明“生产代码中不应出现”的验证文字；如果命中验证文字，确认不再把旧模式描述为支持路径。

- [ ] **步骤 5：提交文档和 E2E 静态检查**

```bash
git add docs/remote-ai-basic-usage.md docs/remote-ai-validation-steps.md test/remote-ai/e2e/remoteAiFullE2E.js
git commit -m "docs: document native remote codex execution"
```

## Task 7: 全量验证

**Files:**
- 无代码改动；验证当前分支状态。

- [ ] **步骤 1：运行 bridge 编译**

```bash
node ./node_modules/gulp/bin/gulp.js compile-extension:ai-codex-remote-bridge
```

预期：退出码 0。

- [ ] **步骤 2：运行 RemoteAI 相关单元测试**

```bash
npx mocha --timeout 10000 --ui=tdd \
  build/remote-ai/test/*.test.js \
  extensions/our-remote-ssh/src/test/*.test.js \
  extensions/ai-codex-remote-bridge/src/test/*.test.js
```

预期：全部 passing。

- [ ] **步骤 3：运行静态移除检查**

```bash
rg -n "localRemoteCodexRunner|runLocalCodexRemoteWorkspaceTask|createLocalMirrorRoot|buildRsyncPullArgs|buildRsyncPushArgs|local-remote-workspaces" extensions/ai-codex-remote-bridge/src extensions/ai-codex-remote-bridge/package.json
```

预期：无输出，退出码 1。

```bash
rg -n "rsync" extensions/ai-codex-remote-bridge/src extensions/ai-codex-remote-bridge/package.json
```

预期：无输出，退出码 1。

- [ ] **步骤 4：运行 release doctor**

```bash
node build/remote-ai/releaseDoctor.js remote-releases/dev-compat/manifest.json
```

预期：manifest、sha256、tarball required entries 全部通过。

- [ ] **步骤 5：运行 SSH E2E**

如果当前环境能访问 `ssh dev`，运行：

```bash
REMOTE_AI_RELEASE_CHECK_COMPILE=0 REMOTE_AI_RELEASE_CHECK_E2E=1 scripts/remote-ai-release-check.sh
```

预期：

```text
[remote-ai-release] passed
```

如果当前环境不能访问 `ssh dev`，记录无法运行的原因，并至少运行 Task 7 步骤 1-4。

- [ ] **步骤 6：最终提交验证记录**

如果 Task 7 没有产生文件改动，不提交。若文档中需要记录新的验证结果，更新 `docs/remote-ai-basic-usage.md` 的 `Verified Evidence` 段落并提交：

```bash
git add docs/remote-ai-basic-usage.md
git commit -m "docs: record remote codex validation"
```

## 自审记录

- Spec 覆盖：本计划覆盖删除 mirror/rsync、远程 runner、新配置、文档、单元测试、静态检查和 E2E 验收。
- 占位符扫描：没有未完成占位内容或模糊实现步骤。
- 类型一致性：`RemoteCodexTaskOptions`、`RemoteCodexTaskPlan`、`resolveRemoteCodexPath`、`createRemoteCodexTaskPlan`、`runRemoteCodexWorkspaceTask` 在 Task 1 定义并在后续任务中复用。
