# Aura
[![Feature Requests](https://img.shields.io/github/issues/microsoft/vscode/feature-request.svg)](https://github.com/microsoft/vscode/issues?q=is%3Aopen+is%3Aissue+label%3Afeature-request+sort%3Areactions-%2B1-desc)
[![Bugs](https://img.shields.io/github/issues/microsoft/vscode/bug.svg)](https://github.com/microsoft/vscode/issues?utf8=✓&q=is%3Aissue+is%3Aopen+label%3Abug)
[![Gitter](https://img.shields.io/badge/chat-on%20gitter-yellow.svg)](https://gitter.im/Microsoft/vscode)

## Aura Code Fork

这个仓库是一个基于 Code - OSS 的 Aura Code fork。目标是提供一个可自托管、可通过 OpenSSH 连接远程 Linux 工作区、并能让 AI agent 在正确工作区内读写文件的开发环境。

当前重点不是替换 VS Code 的所有 Remote-SSH 能力，而是把最小可用闭环打通：

- 本机运行 Aura UI。
- 通过 `ssh` 连接远程开发机。
- 在远程机器上安装并启动兼容的 Code-OSS remote server。
- Explorer、编辑器、搜索、终端、Git 和 LSP 都围绕远程工作区运行。
- OpenAI Codex 原生侧栏在本地工作区时操作本地目录，在 SSH 工作区时通过 SSH wrapper 驱动远端 Codex。
- 保留 `RemoteAI: Run Codex Task in Remote Workspace` 作为可自动化的单次任务入口。
- 屏蔽 Code-OSS 原生 Chat / Inline Chat / New Chat 入口，避免和 Codex 侧栏混用。

### 功能点

#### RemoteAI SSH

`extensions/our-remote-ssh` 提供 RemoteAI 的 SSH 入口：

- `RemoteAI: Connect to SSH Host`
- `RemoteAI: Open SSH Dashboard`
- `RemoteAI: Show Diagnostics`
- 兼容 `Remote-SSH: Connect to Host` 入口名。

连接流程是两步式的：

1. 输入或选择 SSH host，例如 `dev`。
2. 浏览远程目录并打开工作区，例如 `/home/hejianglong/remote-ai-manual`。

打开后，窗口会使用 `vscode-remote://ssh-remote+<host>/<path>` 作为工作区 URI。RemoteAI resolver 会通过本机 `ssh` 安装、启动远程 server，并建立本地端口转发。远程 server 的安装目录位于远端 `~/.remote-ai-server/bin/<commit>`。

#### 远程工作区能力

当前已验证的远程能力包括：

- Explorer 读取远程目录。
- 编辑器保存远程文件。
- 集成终端运行在远程 Linux 目录。
- `git status` / `git diff` 作用于远程仓库。
- 全局搜索命中远程文件。
- TypeScript LSP 在远程 Extension Host 中解析符号。
- 内置 smoke 命令写入 `.remote-ai-smoke/workspace-smoke.json`。

这些能力不依赖本地镜像同步。文件读写、终端命令、Git 和 LSP 都发生在远程 server / 远程 extension host 中。

#### Codex 原生侧栏

OpenAI Codex VS Code 扩展仍运行在本地 UI extension host。RemoteAI 对它做了两件事：

1. 补丁打开右侧 secondary sidebar 的版本门槛，让 Codex 面板可以在当前 Code-OSS 版本中显示。
2. 自动管理 `chatgpt.cliExecutable`，让 Codex app-server 在正确位置启动。

行为规则：

- 打开本地文件夹时，Codex 使用本机默认 CLI，直接操作本地工作区。
- 通过 RemoteAI SSH 打开远程工作区时，RemoteAI 自动生成 SSH wrapper，并把 `chatgpt.cliExecutable` 指向这个 wrapper。
- 其他 remote authority 不是 Aura SSH 工作区，Codex bridge 会拒绝执行，避免命令落到不明确的位置。
- 状态栏会显示 `Aura Codex: local mode`、`Aura Codex: checking`、`Aura Codex: remote active` 或 `Aura Codex: remote unavailable`。点击状态项会打开诊断信息。
- wrapper 会通过 `ssh <host>` 进入远程目录，然后启动远端 Linux Codex：

```sh
cd <remote-workspace>
exec <remote-codex> --sandbox danger-full-access --dangerously-bypass-approvals-and-sandbox app-server ...
```

这样右侧 Codex 原生侧栏的 `pwd`、shell 工具和 patch 工具都发生在远程工作目录中，而不是在 macOS 本地尝试访问 `/home/...`。

RemoteAI 在 SSH 连接和打开远程工作区之前完成 runtime 检查、凭据同步、wrapper 生成和 `chatgpt.cliExecutable` 配置。这样点击右侧 Codex 面板时不需要二次刷新；如果远端 runtime 绑定失败，wrapper 会变成只进入远端工作区并输出错误的阻断脚本，不会回退到本机 `codex`。

#### RemoteAI Codex Bridge

`extensions/ai-codex-remote-bridge` 提供命令式 Codex 入口：

- `RemoteAI: Run Codex Task in Remote Workspace`
- `RemoteAI: Run Remote Workspace Smoke`
- `RemoteAI: Apply Approved Codex Patch`
- `RemoteAI: Inspect Remote Codex Workspace`

这个入口适合自动化和 E2E 验证。它按工作区上下文显式分流：

- 本地 `file` 工作区调用本机 Codex CLI。`remoteai.codex.localCliPath` 为空时从本机 `PATH` 解析 `codex`；配置了绝对路径或带目录路径时才扩展对应 bin 目录。
- Aura SSH 工作区调用远端 Linux Codex CLI，并强制 `--cd` 到远程工作区。
- 非 Aura SSH 的其他 remote workspace 直接拒绝执行。

SSH 工作区中的命令形态是：

```sh
codex exec --cd <remote-workspace> --sandbox danger-full-access --dangerously-bypass-approvals-and-sandbox ...
```

它和 Codex 原生侧栏的区别是：

- Codex 原生侧栏适合连续聊天式交互。
- `RemoteAI: Run Codex Task in Remote Workspace` 适合提交一次明确任务并等待完成。

两者在 SSH 工作区中的目标一致：都必须让 Codex 工具实际运行在远程目录，而不是让本机 Codex 去读远程绝对路径。

#### 远端 Codex CLI

远端 Codex 由 Aura Code Runtime Manager 统一管理。连接 SSH 工作区时，Aura 会探测远端平台和 `~/.aura-code/runtimes/registry.json`，选择满足 manifest 的 Codex runtime；如果不存在或版本过旧，则按缓存、内置包、远端下载、本机下载后上传的顺序安装。

可以通过 `remoteai.codex.remoteCliPath` 指定远端绝对路径。该配置必须是远端绝对路径；相对值例如 `codex` 会被拒绝，防止 SSH wrapper 绑定失败后落回本机 PATH。

#### Aura Code Runtime Manager

Aura Code 后续会把 Codex 视为内置 AI runtime，而不是一套只为 Codex 写死的临时安装脚本。Runtime Manager 负责：

- 在本地工作区使用本机 Codex，不启用 SSH wrapper。
- 在 SSH 工作区检查远端 Linux runtime，不存在或版本过旧时自动安装。
- 根据远端平台选择 `linux-x64` 或 `linux-arm64` 包。
- 获取 runtime 的顺序是：本机缓存、安装包内置包、远端服务器直接下载、本机下载后上传。
- 远端直接下载使用 runtime manifest 中的 `officialUrl` / `mirrorUrl`，默认 Codex `0.128.0` 指向 OpenAI 发布在 npm registry 的 Linux 包。
- 没有网络时仍可上传安装包内置基础版本，例如 Codex `0.128.x`，确保核心能力可用。
- 打开 SSH 工作区后自动把本机最新 Codex 凭据和配置同步到远端 `~/.codex`，默认覆盖远端已有的 `auth.json` 和 `config.toml`，但不复制 history、logs、sessions。
- 安装完成后生成 SSH wrapper，并在打开远程工作区前设置 `chatgpt.cliExecutable`。

推荐的远端目录会从现有 Codex 专用路径迁移为：

```text
~/.aura-code/
  runtimes/
    codex/
      0.128.0-linux-x64/
        package/vendor/x86_64-unknown-linux-musl/codex/codex
      current -> 0.128.0-linux-x64
    registry.json
```

版本选择由 runtime manifest 驱动。Aura Code 安装包会带一个基础 manifest 和离线兜底包；有网络时远端服务器可以按 manifest 自己下载官方推荐版本，本机也可以作为下载和上传兜底；无网络时仍能上传内置 Codex `0.128.x` 到远端。以后接入 Claude Code 时，只新增 Claude Code provider adapter，下载、缓存、上传、远端 registry、版本检查、凭据桥接、wrapper/bridge 绑定都复用同一套 Runtime Manager。

#### 新电脑首次使用

如果一台新电脑只安装了 Aura Code 的桌面安装包，远端 AI 能力不是凭空内置在远程机器上的，而是由本机安装包、远程 server 包、OpenAI Codex 扩展和远端 AI runtime 共同组成。

新电脑上需要具备这些本地能力：

- Aura Code 桌面应用，内置 `our.remote-ssh`。
- 可用的 OpenSSH 客户端，能执行 `ssh <host>` 免交互连接目标远程机。
- OpenAI Codex VS Code 扩展，运行在本地 UI extension host。
- 本机 Codex 登录态或 API 配置，通常位于 `~/.codex/config.toml` 和 `~/.codex/auth.json`。
- 一个可用的 remote server release manifest / tarball 来源。
- Aura Code 安装包内置的基础 AI runtime，至少包含 Codex `0.128.x` 的离线兜底版本。

首次连接远程工作区时，Aura Code 会按下面顺序获取远端能力：

1. 本机 `our.remote-ssh` 读取 release manifest，确定要安装的 server commit、tarball、sha256 和兼容性信息。
2. 如果远端 `~/.remote-ai-server/bin/<commit>` 不存在，Aura Code 通过 `ssh` 上传并解包 remote server tarball。
3. 远端 server 启动后，Code-OSS 进入 SSH 工作区，Explorer、终端、搜索、Git、LSP 等能力由远端 server / 远端 extension host 提供。
4. 远端 server 包中包含 `our.ai-codex-remote-bridge`，所以命令式 Codex 能力会随 server 一起到远端。
5. Aura Code Runtime Manager 检查远端 `~/.aura-code/runtimes` 中是否已有满足 manifest 的 Codex。
6. 如果远端 Codex 不存在或版本过旧，Runtime Manager 先查本机缓存，再查安装包内置包；两者都没有时，如果 `aura.runtime.remoteDownloadEnabled` 和 `aura.runtime.networkEnabled` 都开启，则让远端服务器用 `curl` 或 `wget` 直接下载 manifest 中的官方包；最后才由本机下载到缓存并上传。
7. Runtime Manager 解包 Codex 到远端，写入 `registry.json`，并把 `current` 指向可用版本。
8. Aura Code 读取本机 `~/.codex/auth.json` 和 `~/.codex/config.toml`，通过 SSH stdin 写入远端 `~/.codex`。默认 `remoteai.codex.credentialsOverwrite=true`，每次 SSH 激活都会把本机最新配置推送到远端；需要保留远端独立账号时可手动关闭覆盖。
9. Aura Code 自动生成本机 SSH wrapper，并把本机 Codex 扩展的 `chatgpt.cliExecutable` 指向这个 wrapper。
10. Codex 原生侧栏首次打开时，通过 wrapper 在远端工作目录启动 `codex app-server`，不需要额外 reload。

如果新电脑只有桌面 app，但没有配置 release manifest / tarball，Aura Code 无法知道该给远程机器安装哪一份 remote server。当前开发验证环境通过 `scripts/remote-ai-validate.sh` 写入这些设置：

```json
"remoteai.ssh.serverManifestPath": ".../remote-releases/<commit>/manifest.json",
"remoteai.ssh.serverTarballPath": ".../remote-releases/<commit>/vscode-reh-linux-x64.tar.gz",
"remoteai.ssh.commit": "<commit>"
```

正式分发安装包时，有两种推荐方式：

- 随安装包附带 remote server manifest / tarball、runtime manifest 和 Codex `0.128.x` 离线兜底包，并在首次启动时写入上述设置。
- 提供可访问的 release URL / manifest 服务，让 Aura Code 按 `serverDownloadUrlTemplate` 下载匹配 commit 的远程 server，并按 runtime manifest 下载匹配远端平台的 AI runtime。

远端 AI 是否可用，最终取决于三件事同时成立：

- 远端 server 已安装并能启动。
- 远端 Linux Codex runtime 已安装，并能读取由 Aura Code 桥接过去的 Codex 配置或登录态。
- 本地 Codex 扩展的 `chatgpt.cliExecutable` 已切到 Aura Code 生成的 SSH wrapper；状态栏显示 `Aura Codex: remote active`。

完整 Runtime Manager 设计见 [Aura Code Runtime Manager 设计](docs/superpowers/specs/2026-05-04-aura-code-runtime-manager-design.md)。

### 实现原理

#### 远程连接

RemoteAI SSH 注册 `ssh-remote` authority resolver。当用户打开 `vscode-remote://ssh-remote+dev/home/...` 时：

1. resolver 读取本地 release manifest。
2. 如果远端 server 缺失，就通过 SSH stdin 上传并解包 tarball。
3. 在远端启动 `remote-ai-server`。
4. 解析远端 server 输出的 listening marker。
5. 建立本地 SSH tunnel。
6. 返回 `ResolvedAuthority` 给 workbench。

关键模块：

- `extensions/our-remote-ssh/src/resolver.ts`
- `extensions/our-remote-ssh/src/serverInstaller.ts`
- `extensions/our-remote-ssh/src/serverLauncher.ts`
- `extensions/our-remote-ssh/src/tunnelManager.ts`
- `extensions/our-remote-ssh/src/workspaceTarget.ts`

#### 远程 server 打包

远程 server 包由 `build/remote-ai/packageServer.js` 生成。它会把 Code-OSS remote server、兼容来源中的 Linux native module、内置 RemoteAI 扩展和 manifest 元数据组合成：

```text
remote-releases/<commit>/vscode-reh-linux-x64.tar.gz
remote-releases/<commit>/manifest.json
```

`build/remote-ai/releaseDoctor.js` 会校验：

- tarball 是否存在。
- sha256 和 size 是否匹配 manifest。
- 必要的 server 文件是否存在。
- 最低 glibc 兼容元数据是否存在。

#### 远端 AI 工作流

RemoteAI 里的“远端 AI”实际有两条执行链路：Codex 原生侧栏链路和 RemoteAI Codex Bridge 链路。两条链路都要求 AI 的工具执行环境在远端工作目录中，但入口和交互方式不同。

##### Codex 原生侧栏链路

这条链路用于右侧 Codex 面板的连续聊天体验。完整流程如下：

1. 用户通过 RemoteAI SSH 打开远程工作区，例如 `ssh-remote+dev` + `/home/hejianglong/remote-ai-manual`。
2. `our.remote-ssh` 在本地 UI extension host 中激活，检查当前 workspace URI。
3. 如果 URI 是 `vscode-remote://ssh-remote+dev/...`，它生成一个本机 wrapper：

```text
<globalStorage>/codex-ui/remote-ai-codex-ssh-dev
```

4. `our.remote-ssh` 把本机设置 `chatgpt.cliExecutable` 更新为 wrapper 路径。
5. 用户点击 `Reload Window`，让 OpenAI Codex 扩展重新启动自己的 `codex app-server`。
6. OpenAI Codex 扩展仍以为自己在本机执行：

```sh
<chatgpt.cliExecutable> app-server --analytics-default-enabled
```

7. 实际执行的是 RemoteAI wrapper。wrapper 把命令转换为：

```sh
ssh dev 'cd /home/hejianglong/remote-ai-manual && exec /home/hejianglong/.remote-ai-server/codex/0.128.0-linux-x64/bin/codex --sandbox danger-full-access --dangerously-bypass-approvals-and-sandbox app-server --analytics-default-enabled'
```

8. Codex app-server 因此运行在远程 Linux 进程中，当前目录是远端工作区。
9. Codex 面板里的 shell、文件读取、patch apply 都由这个远端 app-server 执行。
10. 写入 `README.md` 时，实际写的是远端 `/home/hejianglong/remote-ai-manual/README.md`。

这个设计的关键点是：OpenAI Codex VS Code 扩展仍留在本机 UI 里显示界面，但它启动的 Codex 后端进程被 wrapper 重定向到了远端。这样既保留原生侧栏体验，又避免本机 macOS 进程尝试访问不存在的 `/home/...` 路径。

如果没有 wrapper，本机 Codex app-server 会出现典型失败：

```text
Failed to read file to update /home/.../README.md: No such file or directory
```

这不是 AI 不会写文件，而是工具进程运行在本机，无法访问远端 Linux 绝对路径。

##### RemoteAI Codex Bridge 链路

这条链路用于命令面板中的一次性任务，例如 `RemoteAI: Run Codex Task in Remote Workspace`。完整流程如下：

1. 用户在 SSH 工作区运行 RemoteAI Codex 命令。
2. `our.ai-codex-remote-bridge` 在 workspace extension host 中执行，因此它看到的 `workspaceFolders[0].uri.fsPath` 已经是远端路径。
3. bridge 解析 `remoteai.codex.remoteCliPath`，找到远端 Linux Codex CLI。
4. bridge 调用：

```sh
codex exec \
  --cd /home/hejianglong/remote-ai-manual \
  --sandbox danger-full-access \
  --dangerously-bypass-approvals-and-sandbox \
  --add-dir <remote-global-storage> \
  --output-last-message /home/hejianglong/remote-ai-manual/.remote-ai-codex/last-message.md \
  "<user task>"
```

5. Codex 在远程工作目录中读文件、运行命令、应用 patch。
6. 任务结束后，最后回复写入 `.remote-ai-codex/last-message.md`，远端 `git diff` 能看到实际改动。

这条链路不需要 Codex 原生侧栏，也不依赖本机 wrapper。它更适合 E2E、批处理、自动验证和明确的一次性任务。

##### 为什么不用本地镜像同步

曾经可选的思路是把远程目录 rsync 到本地镜像，让本机 Codex 修改镜像，再同步回远程。这个思路能完成某些批处理任务，但不适合 Codex 原生侧栏：

- Codex 面板和 VS Code Explorer 展示的是远端路径，本地镜像路径不同。
- Codex 工具报告会混淆 `/home/...` 和本机镜像目录。
- 文件监听、Git、LSP、终端和 patch 上下文容易不一致。
- macOS `workspace-write` sandbox 会拦截 SSH 网络访问。

因此当前稳定方案是：SSH 工作区中让 AI 工具进程直接在远端运行；本地工作区中让 AI 工具进程直接在本地运行。

#### Codex UI wrapper

SSH wrapper 由 `extensions/our-remote-ssh/src/codexUiWrapper.ts` 生成。它只在当前 workspace 是 `vscode-remote` 且 authority 以 `ssh-remote+` 开头时启用。

生成路径类似：

```text
<globalStorage>/codex-ui/remote-ai-codex-ssh-dev
```

wrapper 会安全引用 host、远程目录和远端 Codex CLI 路径，并把 Codex 原生侧栏传入的参数原样追加到远端 Codex 命令后面。这样 Codex 扩展仍以为自己启动的是一个普通 `codex` 可执行文件，但实际进程已经在远端工作目录中。

当切回本地文件夹时，如果 `chatgpt.cliExecutable` 指向 RemoteAI 管理的 wrapper，RemoteAI 会把它清空，让 Codex 回到本地默认 CLI。

#### 权限模型

当前 Codex 远程执行默认使用最高权限：

```sh
--sandbox danger-full-access
--dangerously-bypass-approvals-and-sandbox
```

这样可以避开 macOS `workspace-write` sandbox 对 SSH 网络访问和远程路径的限制。风险是 Codex 在远程机器上拥有完整 shell 能力，因此应只用于可信远程主机和可信工作区。

### 常用命令

准备验证环境：

```sh
PATH="/usr/local/opt/node@22/bin:$PATH" scripts/remote-ai-validate.sh --prepare-only
```

启动验证窗口：

```sh
PATH="/usr/local/opt/node@22/bin:$PATH" scripts/remote-ai-validate.sh
```

完整 release gate：

```sh
env -u ELECTRON_RUN_AS_NODE \
  REMOTE_AI_RELEASE_CHECK_E2E=1 \
  PATH="/usr/local/opt/node@22/bin:$PATH" \
  scripts/remote-ai-release-check.sh
```

验证 Aura Code 离线兜底时，将 `aura.runtime.networkEnabled` 设置为 `false`，并确认 `resources/aura-code/runtimes/codex/0.128.0-linux-x64.tar.gz` 存在。

验证远端服务器自行下载 runtime 时，保持 `aura.runtime.networkEnabled=true` 和 `aura.runtime.remoteDownloadEnabled=true`，并确保远端有 `curl` 或 `wget`。如果远端已有同版本 registry 记录，先清理远端 `~/.aura-code/runtimes/registry.json` 中的 `codex` 项或换一个 manifest 版本再测。

打包前准备内置 runtime：

```sh
scripts/remote-ai-package-runtimes.sh
```

该脚本会读取 `resources/aura-code/runtime-manifest.json`，把缺失的 Codex Linux 包下载到 `resources/aura-code/runtimes/codex/`。`scripts/remote-ai-package-darwin.sh` 默认会先执行它，并把整个 `resources/aura-code` 复制进 `.app/Contents/Resources/aura-code`。

打包远程 server：

```sh
node build/remote-ai/packageServer.js \
  --source ../vscode-reh-linux-x64 \
  --commit <commit> \
  --release-dir remote-releases/<commit> \
  --compat-server-source ../remote-server/extracted/vscode-reh-linux-x64 \
  --min-glibc 2.17 \
  --include-extension extensions/ai-codex-remote-bridge
```

校验包：

```sh
node build/remote-ai/releaseDoctor.js remote-releases/<commit>/manifest.json
```

更详细的手工验收步骤见 [RemoteAI Validation Steps](docs/remote-ai-validation-steps.md)。

### 当前边界

- 纯本机 Codex 原生侧栏不能直接写远程 Linux 绝对路径。它必须通过 SSH wrapper 驱动远端 Codex，或者使用 RemoteAI Codex Bridge 的单次任务入口。
- SSH wrapper 变更后必须重载窗口，才能让已经启动的 Codex app-server 重新启动。
- 远端 Codex 依赖 `ssh <host>` 免交互可用。
- 远端 Codex CLI 需要 Linux 包，macOS 本机 Codex 二进制不能直接放到远端运行。
- 当前默认是 full access，适合开发验证和可信环境，不适合不可信代码仓库。

## The Repository

This repository ("`Code - OSS`") is where we (Microsoft) develop the [Visual Studio Code](https://code.visualstudio.com) product together with the community. Not only do we work on code and issues here, we also publish our [roadmap](https://github.com/microsoft/vscode/wiki/Roadmap), [monthly iteration plans](https://github.com/microsoft/vscode/wiki/Iteration-Plans), and our [endgame plans](https://github.com/microsoft/vscode/wiki/Running-the-Endgame). This source code is available to everyone under the standard [MIT license](https://github.com/microsoft/vscode/blob/main/LICENSE.txt).

## Visual Studio Code

<p align="center">
  <img alt="VS Code in action" src="https://user-images.githubusercontent.com/35271042/118224532-3842c400-b438-11eb-923d-a5f66fa6785a.png">
</p>

[Visual Studio Code](https://code.visualstudio.com) is a distribution of the `Code - OSS` repository with Microsoft-specific customizations released under a traditional [Microsoft product license](https://code.visualstudio.com/License/).

[Visual Studio Code](https://code.visualstudio.com) combines the simplicity of a code editor with what developers need for their core edit-build-debug cycle. It provides comprehensive code editing, navigation, and understanding support along with lightweight debugging, a rich extensibility model, and lightweight integration with existing tools.

Visual Studio Code is updated monthly with new features and bug fixes. You can download it for Windows, macOS, and Linux on [Visual Studio Code's website](https://code.visualstudio.com/Download). To get the latest releases every day, install the [Insiders build](https://code.visualstudio.com/insiders).

## Contributing

There are many ways in which you can participate in this project, for example:

* [Submit bugs and feature requests](https://github.com/microsoft/vscode/issues), and help us verify as they are checked in
* Review [source code changes](https://github.com/microsoft/vscode/pulls)
* Review the [documentation](https://github.com/microsoft/vscode-docs) and make pull requests for anything from typos to additional and new content

If you are interested in fixing issues and contributing directly to the code base,
please see the document [How to Contribute](https://github.com/microsoft/vscode/wiki/How-to-Contribute), which covers the following:

* [How to build and run from source](https://github.com/microsoft/vscode/wiki/How-to-Contribute)
* [The development workflow, including debugging and running tests](https://github.com/microsoft/vscode/wiki/How-to-Contribute#debugging)
* [Coding guidelines](https://github.com/microsoft/vscode/wiki/Coding-Guidelines)
* [Submitting pull requests](https://github.com/microsoft/vscode/wiki/How-to-Contribute#pull-requests)
* [Finding an issue to work on](https://github.com/microsoft/vscode/wiki/How-to-Contribute#where-to-contribute)
* [Contributing to translations](https://aka.ms/vscodeloc)

## Feedback

* Ask a question on [Stack Overflow](https://stackoverflow.com/questions/tagged/vscode)
* [Request a new feature](CONTRIBUTING.md)
* Upvote [popular feature requests](https://github.com/microsoft/vscode/issues?q=is%3Aopen+is%3Aissue+label%3Afeature-request+sort%3Areactions-%2B1-desc)
* [File an issue](https://github.com/microsoft/vscode/issues)
* Connect with the extension author community on [GitHub Discussions](https://github.com/microsoft/vscode-discussions/discussions) or [Slack](https://aka.ms/vscode-dev-community)
* Follow [@code](https://twitter.com/code) and let us know what you think!

See our [wiki](https://github.com/microsoft/vscode/wiki/Feedback-Channels) for a description of each of these channels and information on some other available community-driven channels.

## Related Projects

Many of the core components and extensions to VS Code live in their own repositories on GitHub. For example, the [node debug adapter](https://github.com/microsoft/vscode-node-debug) and the [mono debug adapter](https://github.com/microsoft/vscode-mono-debug) repositories are separate from each other. For a complete list, please visit the [Related Projects](https://github.com/microsoft/vscode/wiki/Related-Projects) page on our [wiki](https://github.com/microsoft/vscode/wiki).

## Bundled Extensions

VS Code includes a set of built-in extensions located in the [extensions](extensions) folder, including grammars and snippets for many languages. Extensions that provide rich language support (code completion, Go to Definition) for a language have the suffix `language-features`. For example, the `json` extension provides coloring for `JSON` and the `json-language-features` extension provides rich language support for `JSON`.

## Development Container

This repository includes a Visual Studio Code Dev Containers / GitHub Codespaces development container.

* For [Dev Containers](https://aka.ms/vscode-remote/download/containers), use the **Dev Containers: Clone Repository in Container Volume...** command which creates a Docker volume for better disk I/O on macOS and Windows.
  * If you already have VS Code and Docker installed, you can also click [here](https://vscode.dev/redirect?url=vscode://ms-vscode-remote.remote-containers/cloneInVolume?url=https://github.com/microsoft/vscode) to get started. This will cause VS Code to automatically install the Dev Containers extension if needed, clone the source code into a container volume, and spin up a dev container for use.

* For Codespaces, install the [GitHub Codespaces](https://marketplace.visualstudio.com/items?itemName=GitHub.codespaces) extension in VS Code, and use the **Codespaces: Create New Codespace** command.

Docker / the Codespace should have at least **4 Cores and 6 GB of RAM (8 GB recommended)** to run a full build. See the [development container README](.devcontainer/README.md) for more information.

## Code of Conduct

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/). For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.

## License

Copyright (c) Microsoft Corporation. All rights reserved.

Licensed under the [MIT](LICENSE.txt) license.
