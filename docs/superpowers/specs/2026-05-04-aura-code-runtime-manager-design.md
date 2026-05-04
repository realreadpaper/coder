# Aura Code Runtime Manager 设计

## 背景

Aura Code 当前已经打通了通过 SSH 打开远程 Linux 工作区，并让 Codex 原生侧栏通过 SSH wrapper 驱动远端 Codex 的闭环。这个闭环证明了一个关键判断：AI 工具进程必须运行在真实工作区所在的机器上。本地文件夹使用本机 AI runtime；SSH 工作区使用远端 Linux AI runtime。

现有实现仍然偏 Codex 专用：远端 CLI 安装目录、wrapper 生成、bridge 命令和配置项都以 Codex 为中心。后续如果接入 Claude Code，不应该再复制一套平行逻辑。Aura Code 需要一个统一的 runtime 管理层，把 Codex、Claude Code 等 AI CLI 都视为可安装、可校验、可升级、可被 wrapper 或 bridge 调用的 agent runtime。

## 目标

- 产品名称统一为 Aura Code。
- 建立 Aura Code Runtime Manager，统一管理 Codex 当前接入和 Claude Code 后续接入。
- 打开本地工作区时，AI 直接使用本机 runtime，不启用远程 wrapper。
- 打开 SSH 工作区时，自动检查远端 runtime；不存在或版本过旧则自动安装或升级。
- 优先从官方来源获取与远端平台匹配的版本。
- 没有网络时，使用安装包内置的基础版本，例如 Codex 0.128.x，确保核心功能可用。
- runtime 安装和升级必须由 manifest 驱动，避免把版本逻辑写死在 Codex 专用脚本里。

## 非目标

- 不在这一阶段重写 Code-OSS remote server 安装机制。
- 不把远程目录同步成本地镜像给本机 AI 修改。
- 不要求所有 AI runtime 都随安装包完整内置；安装包只需要提供离线可用的基础兜底版本。
- 不在第一阶段实现 Claude Code 的完整 UI 体验，只预留 provider 接口和目录结构。

## 推荐方案

采用类似 GoLand 的按需安装模型：Aura Code 启动 SSH 工作区时检测远端 runtime 状态，缺失或过旧就安装。在线时优先下载官方版本；离线时上传本机安装包内置的基础版本。

解析顺序如下：

1. 远端已有符合 manifest 要求的 runtime，直接使用。
2. 本机缓存中已有匹配远端平台的 runtime 包，上传到远端。
3. 从官方来源下载 manifest 指定版本，校验 sha256 后上传到远端。
4. 从 Aura Code 配置的镜像源下载，校验 sha256 后上传到远端。
5. 使用 Aura Code 安装包内置的基础版本，例如 Codex 0.128.x。
6. 仍失败时提示用户手工准备 runtime，并给出目标路径和验证命令。

这个方案比“每次打包都内置所有最新 runtime”更合理：安装包更小，能按远端 Linux 架构选择 x64 或 arm64，升级节奏可以由 manifest 控制，同时仍然保留无网络可用的底线。

## 架构

Aura Code Runtime Manager 由五个部分组成：

### Runtime Manifest

manifest 描述每个 provider 的版本策略、平台包、校验值、启动命令和离线兜底版本。它随 Aura Code 安装包发布，也可以由企业内网镜像覆盖。

字段结构：

```json
{
  "schemaVersion": 1,
  "providers": {
    "codex": {
      "displayName": "Codex",
      "recommendedVersion": "0.128.0",
      "minimumVersion": "0.128.0",
      "bundledFallbackVersion": "0.128.0",
      "commands": {
        "sidebar": "app-server",
        "exec": "exec"
      },
      "platforms": {
        "linux-x64": {
          "officialUrl": "string",
          "mirrorUrl": "string",
          "sha256": "string",
          "binPath": "bin/codex"
        },
        "linux-arm64": {
          "officialUrl": "string",
          "mirrorUrl": "string",
          "sha256": "string",
          "binPath": "bin/codex"
        }
      }
    }
  }
}
```

文档中的 `string` 表示由 release 流程写入的真实值；实现时不使用示例 URL。

### Provider Adapter

每个 AI runtime 通过 provider adapter 接入统一生命周期。Codex adapter 第一阶段必须支持：

- 识别本地或远端 Codex 版本。
- 计算目标平台包名。
- 安装、解包、校验 `bin/codex`。
- 生成 Codex 原生侧栏 SSH wrapper。
- 为 bridge 生成 `codex exec` 命令。
- 同步或提示配置 `~/.codex/config.toml` 和 `~/.codex/auth.json`。

Claude Code 后续只需要新增 adapter，而不改 SSH 工作区识别、缓存、下载、上传、远端 registry、wrapper 管理这些公共逻辑。

### Local Cache

本机缓存保存已经下载或安装包内置的 runtime 包：

```text
~/Library/Application Support/Aura Code/
  runtimes/
    cache/
      codex/
        0.128.0-linux-x64.tar.gz
        0.128.0-linux-arm64.tar.gz
  wrappers/
    codex/
      ssh-dev
```

缓存命中时不需要重新联网下载。所有缓存包在使用前都要校验 sha256。

### Remote Registry

远端 registry 记录 Aura Code 已安装的 runtime：

```text
~/.aura-code/
  runtimes/
    codex/
      0.128.0-linux-x64/
        bin/codex
      current -> 0.128.0-linux-x64
    registry.json
```

`registry.json` 记录 provider、version、platform、installPath、binPath、sha256、installedAt 和 source。`current` symlink 指向当前被 Aura Code 选中的版本。

为了兼容已有验证环境，第一阶段可以继续读取 `~/.remote-ai-server/codex/...` 和 `remoteai.codex.remoteCliPath`，但新安装路径使用 `~/.aura-code/runtimes/...`。兼容路径只读迁移，不作为长期主路径。

### Workspace Binding

Aura Code 根据 workspace URI 决定 runtime 位置：

- 本地文件夹：清理 Aura Code 管理的 `chatgpt.cliExecutable` wrapper 配置，让 Codex 使用本机默认 CLI。
- SSH 工作区：检查远端 runtime，生成 wrapper，设置 `chatgpt.cliExecutable`，提示 reload Codex app-server。

这个规则必须是自动的。用户不需要记住“本地用本地，远端用远端”，只要工作区类型正确，Aura Code 就切换到正确执行环境。

## SSH 工作区完整流程

1. 用户通过 Aura Code SSH 打开 `ssh-remote+dev:/home/user/project`。
2. SSH resolver 确保远端 Code-OSS server 可用。
3. Runtime Manager 读取 runtime manifest。
4. Runtime Manager 通过 SSH 获取远端 `uname -m`、系统类型和已安装 registry。
5. Codex provider 判断远端是否已有满足要求的 Codex。
6. 如果缺失或版本过旧，Runtime Manager 按“缓存、官方、镜像、内置兜底”的顺序获取安装包。
7. 安装包通过 SSH 上传到远端临时目录。
8. 远端解包到 `~/.aura-code/runtimes/codex/<version>-<platform>`。
9. 远端执行 `bin/codex --version` 校验可运行。
10. 写入远端 `registry.json` 并更新 `current` symlink。
11. 本机生成 Codex SSH wrapper。
12. Aura Code 设置 `chatgpt.cliExecutable` 指向 wrapper。
13. Aura Code 提示 reload，让 Codex app-server 重新启动。
14. Codex 原生侧栏启动后，实际运行的是远端 `codex app-server`，工作目录是远端项目目录。

## 离线兜底

安装包内置一个基础可用版本，例如 Codex 0.128.x。它不是长期固定版本策略，而是无网络、新电脑、内网环境下的可用底线。

离线兜底需要满足：

- 覆盖 Linux x64；如安装包体积允许，也覆盖 Linux arm64。
- 包含 manifest 里的 sha256 和 size。
- 能通过 SSH 上传到远端并解包。
- 安装后能执行 `codex --version`。
- 如果用户稍后恢复网络，Aura Code 可以按 manifest 升级到推荐版本。

如果远端平台不是内置兜底支持的平台，Aura Code 应明确提示：当前离线包不包含该平台 runtime，需要联网下载或手工导入。

## 升级策略

Aura Code 升级后，新的 manifest 跟随安装包发布。下次打开 SSH 工作区时：

- 远端版本低于 `minimumVersion`：自动升级或阻止使用，并说明原因。
- 远端版本低于 `recommendedVersion` 但仍可用：提示升级，允许继续。
- 远端版本等于推荐版本：直接使用。
- 远端版本高于 manifest 推荐版本：默认保留，除非 provider adapter 明确标记不兼容。

企业或内网场景可以通过配置覆盖 manifest URL 和 mirror URL。所有下载包仍必须经过校验。

## 认证与配置

Runtime Manager 只管理 runtime 二进制，不替用户凭空创建账号登录态。

Codex 第一阶段沿用现有配置模型：

- 本机配置通常位于 `~/.codex/config.toml` 和 `~/.codex/auth.json`。
- SSH 工作区首次安装 runtime 后，可以提示同步这些文件到远端。
- 同步前应显示目标主机和目标路径。
- 如果用户不希望同步，也可以手工在远端完成登录或配置 API key。

后续 Claude Code adapter 应定义自己的 auth/config 规则，但走同一个“检测、提示、同步或手工配置”的公共交互。

## 错误处理

Runtime Manager 需要给出可执行的错误信息：

- SSH 不可用：提示验证 `ssh <host>` 是否免交互成功。
- 远端平台不支持：显示检测到的平台和 manifest 支持的平台。
- 官方下载失败：自动尝试镜像或内置兜底。
- sha256 不匹配：拒绝安装，提示清理缓存或检查镜像。
- 离线且无匹配兜底包：提示手工导入包的目标目录。
- 安装成功但 `--version` 失败：保留日志路径，标记安装失败，不更新 `current`。
- wrapper 已更新但 Codex app-server 未重启：提示 reload。

## 测试计划

- manifest parser 单元测试：版本、平台、source 优先级和 sha256 字段。
- runtime resolver 单元测试：远端已有、缓存命中、官方下载、镜像下载、离线兜底、全部失败。
- registry 单元测试：读写 `registry.json`、更新 `current`、兼容旧 `remoteai.codex.remoteCliPath`。
- Codex provider 单元测试：wrapper 命令、`app-server` 参数透传、`exec` 命令生成。
- 本地工作区测试：确认 Aura Code 管理的 wrapper 配置会被清理。
- SSH 工作区测试：确认缺失 runtime 时会安装并设置 wrapper。
- 离线 E2E：禁用网络，只使用内置 Codex 0.128.x，验证远端文件可被 Codex 修改。
- 升级 E2E：远端预装旧版本，打开工作区后升级到 manifest 推荐版本。

## 分阶段实现

第一阶段：文档和接口

- 添加 Aura Code Runtime Manager 设计文档。
- 在 README 中解释 Aura Code 名称、runtime 管理、在线安装和离线兜底。
- 定义 manifest schema 和 provider adapter 类型。

第二阶段：Codex provider 迁移

- 把现有 Codex CLI 准备逻辑迁移到 Runtime Manager。
- 保持现有 SSH wrapper 行为不变。
- 新安装路径改为 `~/.aura-code/runtimes/codex/...`。
- 兼容读取旧路径和旧配置。

第三阶段：在线下载和缓存

- 支持 manifest 驱动的官方下载、镜像下载、本机缓存。
- 下载包校验 sha256。
- 支持无网络时回退到内置 Codex 0.128.x。

第四阶段：升级和用户体验

- 打开 SSH 工作区时自动检测版本。
- 版本过旧时自动安装或提示升级。
- 安装完成后自动更新 wrapper 并提示 reload。

第五阶段：Claude Code adapter

- 新增 Claude Code provider adapter。
- 复用 manifest、缓存、上传、registry、升级、错误处理。
- 根据 Claude Code 的认证和命令模型补齐 provider 专属逻辑。

## 成功标准

- 新电脑安装 Aura Code 后，即使没有网络，也能通过内置 Codex 0.128.x 在 SSH 工作区完成基础 AI 文件修改。
- 有网络时，Aura Code 能自动安装 manifest 推荐的官方 Codex 版本。
- 打开本地文件夹时 Codex 操作本地目录。
- 打开 SSH 工作区时 Codex 操作远端目录。
- Runtime Manager 不包含 Codex 专用硬编码；Claude Code 可以通过新增 provider adapter 接入。
