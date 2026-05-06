# Local DMG Signing Fast Package 实施计划

> **给 agentic workers：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 按任务实施此计划。步骤使用 checkbox（`- [ ]`）语法跟踪进度。

**目标：** 新增本地快速 DMG 打包链路，对已构建的 `Aura.app` 做 ad-hoc 签名并重新生成可本机测试启动的 DMG，避免每次都跑完整 `vscode-darwin-x64-min`。

**架构：** 将签名与 DMG 生成拆成两个脚本：`remote-ai-sign-darwin-local.sh` 只负责本地 ad-hoc signing 和验证；`remote-ai-package-local-dmg.sh` 复用现有 app，刷新 bundled release/runtime，调用签名脚本，然后生成 DMG 和 SHA256。正式 Developer ID 签名/公证仍保留给 CI 或证书环境，不在本地脚本里伪装。

**技术栈：** Bash, `codesign`, `spctl`, `hdiutil`, `ditto`, Node/package metadata, Mocha static tests。

---

### Task 1: Static Tests

**Files:**
- 新建：`build/remote-ai/test/localDarwinPackageScripts.test.js`
- 目标脚本：`scripts/remote-ai-sign-darwin-local.sh`
- 目标脚本：`scripts/remote-ai-package-local-dmg.sh`

- [ ] **步骤 1：编写失败测试**

测试应读取两个脚本，断言签名脚本使用 `codesign --sign -`、验证脚本执行 `codesign --verify --deep --strict`，快速 DMG 脚本不调用 `vscode-darwin-x64-min`，并用 `hdiutil create` 生成 DMG。

- [ ] **步骤 2：运行测试，确认失败**

运行：`npx mocha --timeout 10000 --ui=tdd build/remote-ai/test/localDarwinPackageScripts.test.js`

预期：FAIL，因为两个脚本尚不存在。

### Task 2: Local Ad-Hoc Signing Script

**Files:**
- 新建：`scripts/remote-ai-sign-darwin-local.sh`

- [ ] **步骤 1：实现脚本**

脚本接受可选 app path，默认 `../VSCode-darwin-$VSCODE_ARCH/Aura.app`。它先清理 quarantine/provenance 类 xattr，再对 app 执行 `codesign --force --deep --sign -`，最后运行 `codesign --verify --deep --strict --verbose=4`。

- [ ] **步骤 2：运行静态测试，确认通过**

运行：`npx mocha --timeout 10000 --ui=tdd build/remote-ai/test/localDarwinPackageScripts.test.js`

预期：PASS。

### Task 3: Fast Local DMG Script

**Files:**
- 新建：`scripts/remote-ai-package-local-dmg.sh`

- [ ] **步骤 1：实现脚本**

脚本默认不构建 app，只复用 `../VSCode-darwin-$VSCODE_ARCH/Aura.app`；如果 app 不存在，给出明确错误并提示先运行 `scripts/remote-ai-package-darwin.sh`。它刷新 bundled remote releases 和 Aura runtime，调用本地签名脚本，用 `hdiutil create -volname Aura -srcfolder "$APP_PATH" -ov -format UDZO` 生成 `.build/remote-ai-release/client/Aura-darwin-$VSCODE_ARCH-local-signed.dmg`，并更新 SHA256 文件。

- [ ] **步骤 2：运行静态测试，确认通过**

运行：`npx mocha --timeout 10000 --ui=tdd build/remote-ai/test/localDarwinPackageScripts.test.js`

预期：PASS。

### Task 4: End-to-End Local Verification

**Files:**
- 产物：`.build/remote-ai-release/client/Aura-darwin-x64-local-signed.dmg`

- [ ] **步骤 1：运行快速打包脚本**

运行：`scripts/remote-ai-package-local-dmg.sh`

预期：生成本地签名 DMG，耗时显著低于完整构建。

- [ ] **步骤 2：验证签名和 DMG**

运行：
`codesign --verify --deep --strict --verbose=4 ../VSCode-darwin-x64/Aura.app`
`hdiutil verify .build/remote-ai-release/client/Aura-darwin-x64-local-signed.dmg`

预期：两个命令退出码为 0。

- [ ] **步骤 3：挂载/启动冒烟验证**

运行：挂载 DMG，确认 `/Volumes/Aura/Aura.app` 存在；用临时 user-data 启动并确认进程可创建。验证后卸载 DMG。

预期：DMG 可挂载，app 不再因为 unsigned 直接失败。
