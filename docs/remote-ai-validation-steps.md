# RemoteAI Validation Steps

本文档用于从源码构建的 Code-OSS fork 中，手工验证 RemoteAI 当前能力是否可用。目标不是解释架构，而是给出可以逐项执行、逐项判定的验证步骤。

## 0. 前置条件

在本机执行：

```sh
cd /Users/jianglong/Desktop/project/fuck_remote/code-oss
git status --short --branch
git log -1 --oneline
```

期望：

- 当前分支是 `main`。
- 工作区没有未解释的脏改动。
- 最新提交至少包含 `ef29baa fix: hide remaining native chat UI affordances`，或位于它之后。

确认 `ssh dev` 可用：

```sh
ssh dev 'pwd; hostname; ldd --version | head -n 1'
```

期望：

- 命令能免交互返回。
- 远程机器能执行基础 shell 命令。
- 如果远程是 CentOS 7，`ldd` 通常显示 `glibc 2.17`。

本项目建议显式使用 Node 22：

```sh
export PATH="/usr/local/opt/node@22/bin:$PATH"
node -v
npm -v
```

## 1. 重新编译源码

执行：

```sh
PATH="/usr/local/opt/node@22/bin:$PATH" npm run compile
```

期望：

- 编译结束，没有 TypeScript 编译错误。
- 终端输出中不应出现 RemoteAI 扩展相关的 compile failure。

如果只是验证文档或配置变更，可以跳过本步骤；如果验证 UI 或远程能力，必须先跑一次。

## 2. 准备验证环境

执行：

```sh
PATH="/usr/local/opt/node@22/bin:$PATH" scripts/remote-ai-validate.sh --prepare-only
```

脚本会做这些事：

- 检查或生成 `remote-releases/dev-compat/manifest.json`。
- 检查或生成 `remote-releases/dev-compat/vscode-reh-linux-x64.tar.gz`。
- 写入干净用户数据目录 `/tmp/remote-ai-validate-user-data`。
- 准备远程工作区 `/home/hejianglong/remote-ai-manual`。

期望输出包含：

```text
[remote-ai] user-data: /tmp/remote-ai-validate-user-data
[remote-ai] logs:      /tmp/remote-ai-validate-logs
[remote-ai] host:      dev
[remote-ai] path:      /home/hejianglong/remote-ai-manual
[remote-ai] prepare-only complete.
```

## 3. 启动 Aura

先关闭所有旧的 Aura 窗口。旧窗口可能缓存命令、视图和扩展状态，影响 Chat 屏蔽验证。

推荐使用封装脚本：

```sh
PATH="/usr/local/opt/node@22/bin:$PATH" scripts/remote-ai-validate.sh
```

也可以手工启动：

```sh
VSCODE_SKIP_PRELAUNCH=1 PATH="/usr/local/opt/node@22/bin:$PATH" ./scripts/code.sh \
  --skip-welcome \
  --skip-release-notes \
  --disable-workspace-trust \
  --disable-telemetry \
  --disable-updates \
  --user-data-dir=/tmp/remote-ai-validate-user-data \
  --logsPath=/tmp/remote-ai-validate-logs
```

期望：

- Aura 正常显示 workbench。
- 不出现黑屏。
- 如果出现远程 OS 兼容性提示，选择 `Allow` 后继续验证。

不要直接执行：

```sh
open -n ".build/electron/Aura.app"
```

源码开发态需要通过 `scripts/code.sh` 注入开发环境；直接打开 app bundle 容易启动出黑屏或加载到错误上下文。

## 4. 验证原生 Chat UI 已屏蔽

打开 Command Palette：

```text
Cmd+Shift+P
```

分别搜索：

```text
Chat
Inline Chat
New Chat
Chat:
```

期望：

- 这些关键词不再出现 VS Code 原生 Chat、Inline Chat、Quick Chat、New Chat 入口。
- 搜索结果可以显示 `No matching results`。
- 左侧 Activity Bar / Sidebar 没有原生 Chat 面板入口。
- 空编辑器 watermark 不显示 `Open Chat`。

注意：

- Codex 插件自身的命令如果以 `Codex` 命名出现，不属于本项失败。
- 如果仍看到原生 Chat 命令，先确认是否关闭了旧窗口，并使用 `/tmp/remote-ai-validate-user-data` 这个干净 user-data-dir 重新启动。

## 5. 验证两步 SSH 连接流程

打开 Command Palette：

```text
Cmd+Shift+P
```

运行：

```text
RemoteAI: Open SSH Dashboard
```

在 Dashboard 中填写：

```text
Host: dev
Remote Path: /home/hejianglong/remote-ai-manual
```

验证第一步：SSH host。

- `Host` 输入框中是 `dev`。
- 点击 `Diagnostics` 能生成当前 SSH、server manifest、tarball 和 audit log 信息。

验证第二步：选择远程工作目录。

1. 点击 `Browse Folders`。
2. QuickPick 中应显示远程目录列表。
3. 选择 `Select this folder`，或进入子目录后再选择。
4. Dashboard 的 `Remote Path` 应更新为选择后的远程路径。
5. 点击 `Connect`。

期望：

- 窗口重新加载为远程工作区。
- Explorer 中能看到 `README.md` 和 `index.ts`。
- 窗口 remote authority 应对应 `ssh-remote+dev`。

## 6. 验证远程文件系统

在 Explorer 中打开 `README.md`，追加一行：

```text
manual remote edit
```

保存文件。

在集成终端中执行：

```sh
pwd
grep -n 'manual remote edit' README.md
```

期望：

- `pwd` 是 `/home/hejianglong/remote-ai-manual`。
- `grep` 能找到刚才保存的内容。

这一步验证的是 VS Code remote FileService / FileSystem Provider 路径，而不是本地文件同步。

## 7. 验证远程终端

在 Code-OSS 集成终端执行：

```sh
pwd
hostname
uname -a
which git
```

期望：

- `pwd` 是远程工作区目录。
- `hostname` 是 `dev` 对应开发机，而不是本机 macOS。
- `uname -a` 返回 Linux。
- `git` 来自远程机器。

## 8. 验证远程 Git

在集成终端执行：

```sh
git status --short
git diff -- README.md
```

期望：

- `README.md` 显示为已修改。
- `git diff` 能看到刚才通过 Explorer 保存的内容。

然后可以还原手工改动，避免影响后续验证：

```sh
git checkout -- README.md
```

只在远程验证目录中执行该命令，不要在本地源码仓库执行。

## 9. 验证远程搜索

使用全局搜索：

```text
Cmd+Shift+F
```

搜索：

```text
smokeSymbol
```

期望：

- 搜索命中 `index.ts`。
- 命中的路径属于远程工作区。

## 10. 验证远程 LSP

打开 `index.ts`。

执行以下任一动作：

- 在 `smokeSymbol` 上右键，选择 `Go to Definition`。
- 打开 Outline，确认存在 `smokeSymbol`。
- Command Palette 运行 `Go to Symbol in Editor...`，搜索 `smokeSymbol`。

期望：

- TypeScript 符号能被解析。
- 跳转和符号列表基于远程 Extension Host 工作，而不是本地目录。

## 11. 验证 RemoteAI 内置 Smoke

打开 Command Palette，运行：

```text
RemoteAI: Run Remote Workspace Smoke
```

然后在远程终端执行：

```sh
cat /home/hejianglong/remote-ai-manual/.remote-ai-smoke/workspace-smoke.json
```

期望 JSON 至少包含：

```json
{
  "fsWriteRead": true,
  "execPwd": "/home/hejianglong/remote-ai-manual",
  "terminalPwd": "/home/hejianglong/remote-ai-manual",
  "searchHit": true
}
```

并且 `lspSymbols` 中包含：

```json
"smokeSymbol"
```

## 12. 验证 Codex 远程闭环

前提：

- Codex VS Code 插件已安装并启用。
- 当前窗口已经连接到 `ssh-remote+dev` 的远程工作区。

验证 Codex 是否运行在正确上下文：

1. 确认状态栏显示 `Aura Codex: remote active`。如果显示 `checking`，等待初始化完成；如果显示 `remote unavailable`，点击状态项打开诊断。
2. 打开 Codex 面板或 Codex 命令入口。
3. 确认打开 Codex 不触发窗口 reload。
4. 要求 Codex 读取当前工作区的 `README.md` 和 `index.ts`。
5. 要求 Codex 对 `README.md` 做一个很小的修改。
6. 当审批 UI 出现时，确认审批内容只涉及远程工作区文件。
7. 点击批准。

本地工作区的补充规则：

- 如果打开的是本地 `file` 工作区，Codex 应使用本机 Codex CLI 和本地文件系统。
- 如果打开的是 `ssh-remote+dev` 工作区，Codex 原生侧栏和 `RemoteAI: Run Codex Task in Remote Workspace` 都必须使用远端 Linux Codex CLI。
- 如果不是本地 `file` 也不是 Aura SSH remote，命令式 Codex bridge 应拒绝执行。

在远程终端检查：

```sh
cd /home/hejianglong/remote-ai-manual
git diff -- README.md
```

期望：

- `git diff` 能看到 Codex 修改。
- 修改发生在远程 `/home/hejianglong/remote-ai-manual`，不是本机源码目录。
- 审批 UI 出现后才发生写入。

远程 Codex 验收必须确认：

```sh
ssh dev 'test -f /home/hejianglong/remote-ai-manual/.remote-ai-codex/last-message.md'
ssh dev 'cd /home/hejianglong/remote-ai-manual && git diff -- .'
```

本机源码目录不应出现由远程 Codex 任务生成的业务文件。生产代码中也不应出现 `localRemoteCodexRunner` 或 `rsync` 作为 Codex 执行路径。

也可以使用内置验证命令模拟批准写入：

```text
RemoteAI: Apply Approved Codex Patch
```

期望：

- UI 出现 `Approve Codex patch for README.md?`。
- 点击 `Approve` 后，远程 `git diff -- README.md` 出现 `RemoteAI Codex approved edit`。

## 13. 一键 release gate

完整验证，包括 GUI / SSH E2E：

```sh
REMOTE_AI_RELEASE_CHECK_E2E=1 PATH="/usr/local/opt/node@22/bin:$PATH" scripts/remote-ai-release-check.sh
```

如果刚刚已经完整编译过，可以跳过 compile：

```sh
REMOTE_AI_RELEASE_CHECK_COMPILE=0 REMOTE_AI_RELEASE_CHECK_E2E=1 PATH="/usr/local/opt/node@22/bin:$PATH" scripts/remote-ai-release-check.sh
```

期望最后输出：

```text
[remote-ai-release] passed
```

E2E 会覆盖：

- Chat UI command palette 屏蔽。
- Dashboard 打开。
- `dev` host 输入。
- 远程目录 QuickPick 浏览和选择。
- 远程工作区打开。
- 文件读写。
- 远程终端 `pwd`。
- 远程搜索。
- TypeScript LSP 符号。
- Codex 审批写入模拟。

## 14. 常见问题定位

### Aura 黑屏

处理顺序：

1. 关闭所有旧 Aura 窗口。
2. 使用 `scripts/remote-ai-validate.sh` 启动，不要直接打开 app bundle。
3. 确认 Electron 存在：

```sh
test -x ".build/electron/Aura.app/Contents/MacOS/Electron" && echo ok
```

4. 查看日志：

```sh
ls -lt /tmp/remote-ai-validate-logs
```

### 仍能搜到原生 Chat

处理顺序：

1. 确认当前源码包含 `ef29baa` 或之后的提交。
2. 重新编译：

```sh
PATH="/usr/local/opt/node@22/bin:$PATH" npm run compile
```

3. 使用干净 user data 启动：

```sh
rm -rf /tmp/remote-ai-validate-user-data /tmp/remote-ai-validate-logs
PATH="/usr/local/opt/node@22/bin:$PATH" scripts/remote-ai-validate.sh
```

### SSH 连接失败

先在普通终端验证：

```sh
ssh dev 'pwd; ls -la /home/hejianglong'
```

如果这里失败，问题在 SSH 配置、密钥或远程机器可达性，不在 Code-OSS remote resolver。

### 远程 server 安装失败

检查本地 manifest：

```sh
node build/remote-ai/releaseDoctor.js remote-releases/dev-compat/manifest.json
```

检查远程安装目录：

```sh
ssh dev 'find ~/.remote-ai-server/bin -maxdepth 2 -type f -name remote-ai-server -o -name product.json | sort'
```

需要强制重装时，可以只删除验证 commit 对应目录：

```sh
ssh dev 'rm -rf ~/.remote-ai-server/bin/dev-compat'
```

然后重新运行 `scripts/remote-ai-validate.sh`。

### CentOS 7 兼容性验证

在 `dev` 上执行：

```sh
ldd --version | head -n 1
~/.remote-ai-server/bin/dev-compat/node -v
~/.remote-ai-server/bin/dev-compat/node -e "console.log(process.versions)"
```

期望：

- `ldd` 可为 `glibc 2.17`。
- 远程 server 使用打包进 `dev-compat` 的 Linux Node。
- Node 能在远程直接执行，不依赖本机 macOS 二进制。

这只能证明当前打包产物能在该机器运行；不能用来证明所有 CentOS 7 镜像都兼容。发布前仍需以 release gate 和目标机器真实运行结果为准。

## 15. 通过标准

一次手工验收可以认为基本通过，需要同时满足：

- Code-OSS 能通过 `scripts/remote-ai-validate.sh` 正常启动。
- Command Palette 中原生 Chat / Inline Chat / New Chat / Chat: 入口不可见。
- Dashboard 能完成 `Host -> Browse Folders -> Connect` 两步流程。
- Explorer 能读写远程文件。
- 集成终端运行在远程目录。
- Git diff 在远程可见。
- 搜索能命中远程文件。
- TypeScript LSP 能解析 `smokeSymbol`。
- Codex 或内置 Codex patch 验证能经过审批后修改远程文件。
- `REMOTE_AI_RELEASE_CHECK_E2E=1 scripts/remote-ai-release-check.sh` 最终输出 `[remote-ai-release] passed`。
