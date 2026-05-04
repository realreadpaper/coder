# Remote Codex Native Workspace 设计

## 目标

把 RemoteAI 的 AI agent 执行链路改成 Cursor 风格的远程工作区执行模型：

```text
Local Code-OSS Workbench
  -> our.remote-ssh resolver
  -> RemoteAI Server
  -> Remote Extension Host
  -> ai-codex-remote-bridge
  -> remote Linux Codex CLI
  -> remote workspace files, terminal, git, rg
```

完成后，远程工作区中的 Codex 任务必须直接在远程服务器真实目录中执行。项目不再支持本地 mirror workspace、`rsync pull`、本地 Codex 操作镜像、`rsync push` 这种模式。

## 非目标

- 不重新实现 Remote-SSH resolver；现有 `our.remote-ssh` 仍是远程工作区入口。
- 不把远程工作区降级成 SFTP、SSHFS 或纯 SSH 命令执行器。
- 不把 macOS 或本地 Codex CLI 上传到远程 Linux 使用。
- 不保留 mirror/rsync 作为自动 fallback。
- 不修改 OpenAI Codex VS Code 扩展内部实现。

## 当前问题

当前 Remote-SSH 基础链路已经接近 Cursor：

- `our.remote-ssh` 注册 `ssh-remote` resolver。
- resolver 安装并启动 `~/.remote-ai-server/bin/<commit>/bin/remote-ai-server`。
- resolver 返回 `vscode.ResolvedAuthority`。
- Workbench 打开 `vscode-remote://ssh-remote+<host>/<path>` 工作区。

但 `ai-codex-remote-bridge` 的 Codex 任务链路仍存在本地 mirror/rsync 路径：

```text
remote workspace detected
  -> create local mirror root
  -> rsync pull remote workspace
  -> run local Codex CLI in mirror
  -> rsync push mirror back to remote
```

这会造成语义偏差：用户看到的是远程工作区，但 AI agent 的主执行 cwd、文件读写和工具调用先发生在本地镜像中。这不是 Cursor 的远程 workspace 模型。

## 推荐方案

彻底移除 mirror/rsync runner，只保留远程 Extension Host 原生执行。

远程工作区下的 `remoteai.codex.runTask` 行为改为：

```text
remoteai.codex.runTask
  -> detect vscode.env.remoteName
  -> use remote workspace folder fsPath
  -> resolve/install remote Linux Codex CLI
  -> spawn Codex CLI in Remote Extension Host
  -> cwd = remote workspace root
  -> outputLastMessagePath = remote workspace/.remote-ai-codex/last-message.md
```

本地工作区仍可本地执行 Codex，但本地执行路径只适用于非 remote workspace。

## 组件设计

### `our.remote-ssh`

保持现有职责：

- 解析 `ssh-remote+<host>` authority。
- 通过 SSH bootstrap 安装/启动 RemoteAI Server。
- 建立本地端口转发。
- 返回 `vscode.ResolvedAuthority`。
- 写入审计日志。

本设计不要求修改 resolver 协议。它只要求远程工作区打开后，AI 执行面不再绕回本地 mirror。

### `ai-codex-remote-bridge`

这是新的远程执行面。它必须在 remote workspace 中运行，并直接使用远程文件系统路径。

命令分支：

```ts
if (vscode.env.remoteName) {
  return runRemoteWorkspaceTask(...);
}

return runLocalWorkspaceTask(...);
```

判断依据是 `vscode.env.remoteName`，不是 URI 字符串解析。原因是：真正重要的是当前扩展运行侧。如果扩展运行在 Remote Extension Host，它的 `child_process.spawn`、`workspaceFolder.uri.fsPath`、`fs`、`git`、`rg` 都应指向远程环境。

### 新增 `remoteCodexRunner.ts`

职责：

- 校验当前扩展确实运行在 remote workspace。
- 解析远程 workspace root。
- 选择或安装远程平台 Codex CLI。
- 调用现有 `runCodexWorkspaceTask`。
- 保证 Codex cwd 和输出文件都位于远程 workspace。

建议接口：

```ts
export interface RemoteCodexTaskOptions {
  readonly codexPath?: string;
  readonly workspaceRoot: string;
  readonly prompt: string;
  readonly sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access';
  readonly outputLastMessagePath?: string;
}

export async function runRemoteCodexWorkspaceTask(options: RemoteCodexTaskOptions): Promise<CodexTaskResult>;
```

执行规则：

- `workspaceRoot` 必须来自 `vscode.workspace.workspaceFolders[0].uri.fsPath`。
- `outputLastMessagePath` 默认是 `<workspaceRoot>/.remote-ai-codex/last-message.md`。
- `cwd` 必须是 `workspaceRoot`。
- `additionalWritableRoots` 只能包含远程侧 Codex 状态目录。
- 不允许引用 local mirror root。
- 不允许调用 `rsync`。

### Codex CLI 策略

远程 workspace 下禁止使用 `remoteai.codex.localCliPath` 作为执行路径。该配置只用于本地 workspace。

远程 workspace 使用以下优先级：

1. `remoteai.codex.remoteCliPath`，如果配置存在。
2. `codexCliInstaller.ts` 计算出的远程 Linux 平台安装路径。
3. PATH 中的远程 `codex`，仅在显式允许时作为诊断或开发便利。

远程平台选择规则：

```text
linux x64   -> linux-x64 Codex CLI
linux arm64 -> linux-arm64 Codex CLI
darwin      -> 禁止作为远程 Linux CLI
win32       -> 不纳入本设计
```

如果无法获得远程 Linux Codex CLI，命令必须失败并给出明确错误，不得 fallback 到本地 mirror。

### 删除 mirror/rsync 模式

删除或停止导出：

- `parseSshRemoteWorkspace`
- `createLocalMirrorRoot`
- `buildRsyncPullArgs`
- `buildRsyncPushArgs`
- `buildLocalCodexRemotePrompt`
- `buildLocalCodexRemoteExecArgs`
- `runLocalCodexRemoteWorkspaceTask`

删除文件：

- `extensions/ai-codex-remote-bridge/src/localRemoteCodexRunner.ts`
- `extensions/ai-codex-remote-bridge/src/test/localRemoteCodexRunner.test.js`

删除所有产品文档中把本地 mirror/rsync 描述为远程工作区主链路的内容。

## 数据流

远程工作区执行：

```text
User command
  -> remoteai.codex.runTask
  -> ai-codex-remote-bridge running in Remote Extension Host
  -> remote workspace root from vscode.workspace
  -> remote Codex CLI
  -> remote child_process.spawn
  -> remote filesystem changes
  -> remote git diff
```

本地工作区执行：

```text
User command
  -> remoteai.codex.runTask
  -> ai-codex-remote-bridge running locally
  -> local workspace root
  -> local Codex CLI
  -> local filesystem changes
```

两个路径互斥，不共享 mirror 或同步层。

## 错误处理

远程工作区下遇到以下情况必须直接失败：

- 没有 workspace folder。
- `vscode.env.remoteName` 存在但 workspace root 为空。
- 远程 Codex CLI 不存在且无法安装。
- 检测到 Codex CLI 平台与远程 OS/arch 不匹配。
- 输出路径不能创建在远程 workspace 内。
- Codex 进程启动失败。

错误消息要明确说明失败发生在远程执行面，不能建议用户检查本地 mirror。

## 测试计划

单元测试：

- remote workspace 分支调用 `runRemoteCodexWorkspaceTask`。
- remote workspace 分支不调用 `runLocalWorkspaceTask`。
- remote workspace 分支不引用 `localRemoteCodexRunner`。
- `runRemoteCodexWorkspaceTask` 使用远程 workspace root 作为 cwd。
- `outputLastMessagePath` 默认位于 `<workspaceRoot>/.remote-ai-codex/last-message.md`。
- 远程模式不会构造 rsync 参数。
- 本地 workspace 仍使用本地 Codex runner。

静态检查：

- `rg "rsync|local mirror|local-remote-workspaces|runLocalCodexRemoteWorkspaceTask"` 不应命中生产代码。
- `rg "localRemoteCodexRunner"` 不应命中生产代码。

E2E 验收：

```text
1. 用 RemoteAI 打开 ssh-remote+dev:/home/hejianglong/remote-ai-manual。
2. 执行 remoteai.codex.runTask。
3. 远程 /home/hejianglong/remote-ai-manual 出现 .remote-ai-codex/last-message.md。
4. ssh dev 'cd /home/hejianglong/remote-ai-manual && git diff' 能看到 Codex 改动。
5. 本机 code-oss 源码目录没有对应业务文件改动。
6. 远程日志或进程证据显示 Codex 在远程环境执行。
7. 审计日志记录远程任务开始、成功或失败。
```

## 成功标准

完成后必须满足：

- 远程工作区中的 AI agent 修改直接落在远程真实目录。
- 本地 mirror/rsync 模式从生产代码中移除。
- 远程 Codex CLI 平台选择不复用本机 macOS 二进制。
- 本地 UI 只负责显示、命令入口和审批；远程 Extension Host 负责 workspace 执行。
- 用户不会遇到“看起来远程，实际先改本地镜像”的行为。
