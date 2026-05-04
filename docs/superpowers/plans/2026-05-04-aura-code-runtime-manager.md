# Aura Code Runtime Manager 实施计划

> **给 agentic workers：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 按任务实施此计划。步骤使用 checkbox（`- [ ]`）语法跟踪进度。

**目标：** 实现 Aura Code Runtime Manager 第一版，让 SSH 工作区自动准备远端 Codex runtime，在线使用 manifest 指定版本，离线使用安装包内置 Codex 0.128.x 兜底，并保持本地工作区使用本机 Codex。

**架构：** Runtime Manager 放在 `extensions/our-remote-ssh` 的 UI extension host 中，因为它需要读本机缓存、上传包、执行 SSH、生成 wrapper、更新 `chatgpt.cliExecutable`。Codex 作为第一个 provider 接入，公共层负责 manifest、source 选择、远端 registry 和安装脚本；`ai-codex-remote-bridge` 只迁移默认路径，继续兼容 `remoteai.codex.remoteCliPath`。

**技术栈：** TypeScript、Node.js `fs`/`https`/`crypto`、现有 `sshExec`/`sshPipe`、VS Code configuration API、Mocha-style extension unit tests、shell install script。

---

## 文件结构

- 新建：`extensions/our-remote-ssh/src/auraRuntimeManifest.ts`
  负责解析和校验 runtime manifest，提供 Codex 默认 manifest。
- 新建：`extensions/our-remote-ssh/src/auraRuntimeSource.ts`
  负责按远端平台和版本选择 source：远端已有、本机缓存、官方下载、镜像下载、内置兜底。
- 新建：`extensions/our-remote-ssh/src/auraRuntimeInstaller.ts`
  负责远端 platform/registry 探测、上传 tarball、解包、校验 `--version`、写入 `registry.json`。
- 新建：`extensions/our-remote-ssh/src/codexRuntimeProvider.ts`
  负责 Codex provider 的 platform key、bin path、wrapper 输入、配置同步边界。
- 修改：`extensions/our-remote-ssh/src/codexUiWrapper.ts`
  保持 wrapper 行为，允许 wrapper 路径和 managed prefix 切到 Aura Code 命名，同时兼容旧 prefix。
- 修改：`extensions/our-remote-ssh/src/extension.ts`
  在 SSH workspace 配置 Codex UI 前调用 Runtime Manager，拿到远端 Codex binPath。
- 修改：`extensions/our-remote-ssh/package.json`
  增加 `aura.runtime.*` 配置项，保留旧 `remoteai.codex.*` 设置。
- 修改：`extensions/ai-codex-remote-bridge/src/codexCliInstaller.ts`
  默认远端路径迁移到 `~/.aura-code/runtimes/codex/<version>-<platform>/bin/codex`。
- 修改：`extensions/ai-codex-remote-bridge/src/remoteCodexRunner.ts`
  继续优先使用 `remoteai.codex.remoteCliPath`；未配置时使用 Aura Code 默认路径。
- 新建测试：`extensions/our-remote-ssh/src/test/auraRuntimeManifest.test.js`
- 新建测试：`extensions/our-remote-ssh/src/test/auraRuntimeSource.test.js`
- 新建测试：`extensions/our-remote-ssh/src/test/auraRuntimeInstaller.test.js`
- 新建测试：`extensions/our-remote-ssh/src/test/codexRuntimeProvider.test.js`
- 修改测试：`extensions/our-remote-ssh/src/test/codexUiWrapper.test.js`
- 修改测试：`extensions/ai-codex-remote-bridge/src/test/codexCliInstaller.test.js`

## Task 1: Runtime Manifest

**Files:**
- 新建：`extensions/our-remote-ssh/src/auraRuntimeManifest.ts`
- 新建：`extensions/our-remote-ssh/src/test/auraRuntimeManifest.test.js`

- [ ] **步骤 1：编写失败测试**

```js
const assert = require('assert');
const {
	defaultAuraRuntimeManifest,
	parseAuraRuntimeManifest,
	selectProviderPlatform
} = require('../../out/auraRuntimeManifest');

suite('Aura runtime manifest', () => {
	test('provides Codex 0.128.0 fallback for linux x64', () => {
		const platform = selectProviderPlatform(defaultAuraRuntimeManifest, 'codex', 'linux-x64');
		assert.strictEqual(platform.version, '0.128.0');
		assert.strictEqual(platform.binPath, 'bin/codex');
		assert.strictEqual(platform.bundledPath, 'runtimes/codex/0.128.0-linux-x64.tar.gz');
	});

	test('rejects invalid sha256 values', () => {
		assert.throws(() => parseAuraRuntimeManifest({
			schemaVersion: 1,
			providers: {
				codex: {
					displayName: 'Codex',
					recommendedVersion: '0.128.0',
					minimumVersion: '0.128.0',
					bundledFallbackVersion: '0.128.0',
					commands: { sidebar: 'app-server', exec: 'exec' },
					platforms: {
						'linux-x64': {
							version: '0.128.0',
							officialUrl: '',
							mirrorUrl: '',
							sha256: 'bad',
							size: 1,
							binPath: 'bin/codex',
							bundledPath: 'runtimes/codex/0.128.0-linux-x64.tar.gz'
						}
					}
				}
			}
		}), /invalid sha256/);
	});

	test('rejects missing provider platform', () => {
		assert.throws(() => selectProviderPlatform(defaultAuraRuntimeManifest, 'codex', 'linux-s390x'), /does not support linux-s390x/);
	});
});
```

- [ ] **步骤 2：运行测试，确认失败**

运行：`PATH="/usr/local/opt/node@22/bin:$PATH" npm run gulp -- compile-extension:our-remote-ssh && npx mocha --timeout 10000 --ui=tdd extensions/our-remote-ssh/src/test/auraRuntimeManifest.test.js`

预期：compile 失败，错误包含 `Cannot find module '../../out/auraRuntimeManifest'`。

- [ ] **步骤 3：编写最小实现**

在 `extensions/our-remote-ssh/src/auraRuntimeManifest.ts` 写入：

```ts
export interface AuraRuntimePlatform {
	readonly version: string;
	readonly officialUrl: string;
	readonly mirrorUrl: string;
	readonly sha256: string;
	readonly size: number;
	readonly binPath: string;
	readonly bundledPath: string;
}

export interface AuraRuntimeProvider {
	readonly displayName: string;
	readonly recommendedVersion: string;
	readonly minimumVersion: string;
	readonly bundledFallbackVersion: string;
	readonly commands: {
		readonly sidebar: string;
		readonly exec: string;
	};
	readonly platforms: Record<string, AuraRuntimePlatform>;
}

export interface AuraRuntimeManifest {
	readonly schemaVersion: 1;
	readonly providers: Record<string, AuraRuntimeProvider>;
}

const codexFallbackSha256 = '0000000000000000000000000000000000000000000000000000000000000000';

export const defaultAuraRuntimeManifest: AuraRuntimeManifest = parseAuraRuntimeManifest({
	schemaVersion: 1,
	providers: {
		codex: {
			displayName: 'Codex',
			recommendedVersion: '0.128.0',
			minimumVersion: '0.128.0',
			bundledFallbackVersion: '0.128.0',
			commands: { sidebar: 'app-server', exec: 'exec' },
			platforms: {
				'linux-x64': {
					version: '0.128.0',
					officialUrl: '',
					mirrorUrl: '',
					sha256: codexFallbackSha256,
					size: 0,
					binPath: 'bin/codex',
					bundledPath: 'runtimes/codex/0.128.0-linux-x64.tar.gz'
				},
				'linux-arm64': {
					version: '0.128.0',
					officialUrl: '',
					mirrorUrl: '',
					sha256: codexFallbackSha256,
					size: 0,
					binPath: 'bin/codex',
					bundledPath: 'runtimes/codex/0.128.0-linux-arm64.tar.gz'
				}
			}
		}
	}
});

export function parseAuraRuntimeManifest(value: unknown): AuraRuntimeManifest {
	const manifest = value as AuraRuntimeManifest;
	if (!manifest || manifest.schemaVersion !== 1 || !manifest.providers) {
		throw new Error('Aura runtime manifest must use schemaVersion 1');
	}
	for (const [providerId, provider] of Object.entries(manifest.providers)) {
		if (!provider.displayName || !provider.recommendedVersion || !provider.minimumVersion) {
			throw new Error(`Aura runtime provider ${providerId} is incomplete`);
		}
		for (const [platformKey, platform] of Object.entries(provider.platforms ?? {})) {
			if (!/^[a-f0-9]{64}$/i.test(platform.sha256)) {
				throw new Error(`Aura runtime provider ${providerId} platform ${platformKey} has invalid sha256`);
			}
			if (!platform.binPath || !platform.version || !platform.bundledPath) {
				throw new Error(`Aura runtime provider ${providerId} platform ${platformKey} is incomplete`);
			}
		}
	}
	return manifest;
}

export function selectProviderPlatform(manifest: AuraRuntimeManifest, providerId: string, platformKey: string): AuraRuntimePlatform {
	const provider = manifest.providers[providerId];
	if (!provider) {
		throw new Error(`Aura runtime manifest does not define provider ${providerId}`);
	}
	const platform = provider.platforms[platformKey];
	if (!platform) {
		throw new Error(`Aura runtime provider ${providerId} does not support ${platformKey}`);
	}
	return platform;
}
```

- [ ] **步骤 4：运行测试，确认通过**

运行：`PATH="/usr/local/opt/node@22/bin:$PATH" npm run gulp -- compile-extension:our-remote-ssh && npx mocha --timeout 10000 --ui=tdd extensions/our-remote-ssh/src/test/auraRuntimeManifest.test.js`

预期：测试进程退出码为 0。

- [ ] **步骤 5：提交**

```bash
git add extensions/our-remote-ssh/src/auraRuntimeManifest.ts extensions/our-remote-ssh/src/test/auraRuntimeManifest.test.js
git commit -m "feat: add Aura runtime manifest parser"
```

## Task 2: Runtime Source Resolution

**Files:**
- 新建：`extensions/our-remote-ssh/src/auraRuntimeSource.ts`
- 新建：`extensions/our-remote-ssh/src/test/auraRuntimeSource.test.js`

- [ ] **步骤 1：编写失败测试**

```js
const assert = require('assert');
const { chooseAuraRuntimeSource } = require('../../out/auraRuntimeSource');

suite('Aura runtime source', () => {
	test('uses local cache before network sources', () => {
		const source = chooseAuraRuntimeSource({
			providerId: 'codex',
			platformKey: 'linux-x64',
			version: '0.128.0',
			cachePath: '/cache/codex/0.128.0-linux-x64.tar.gz',
			cacheExists: true,
			bundledPath: '/app/runtimes/codex/0.128.0-linux-x64.tar.gz',
			bundledExists: true,
			officialUrl: 'https://official.invalid/codex.tar.gz',
			mirrorUrl: 'https://mirror.invalid/codex.tar.gz',
			networkAvailable: true
		});
		assert.deepStrictEqual(source, {
			kind: 'cache',
			path: '/cache/codex/0.128.0-linux-x64.tar.gz'
		});
	});

	test('uses official URL before mirror when cache is missing', () => {
		const source = chooseAuraRuntimeSource({
			providerId: 'codex',
			platformKey: 'linux-x64',
			version: '0.128.0',
			cachePath: '/cache/codex/0.128.0-linux-x64.tar.gz',
			cacheExists: false,
			bundledPath: '/app/runtimes/codex/0.128.0-linux-x64.tar.gz',
			bundledExists: true,
			officialUrl: 'https://official.invalid/codex.tar.gz',
			mirrorUrl: 'https://mirror.invalid/codex.tar.gz',
			networkAvailable: true
		});
		assert.deepStrictEqual(source, {
			kind: 'download',
			url: 'https://official.invalid/codex.tar.gz',
			cachePath: '/cache/codex/0.128.0-linux-x64.tar.gz'
		});
	});

	test('uses bundled fallback when offline', () => {
		const source = chooseAuraRuntimeSource({
			providerId: 'codex',
			platformKey: 'linux-x64',
			version: '0.128.0',
			cachePath: '/cache/codex/0.128.0-linux-x64.tar.gz',
			cacheExists: false,
			bundledPath: '/app/runtimes/codex/0.128.0-linux-x64.tar.gz',
			bundledExists: true,
			officialUrl: 'https://official.invalid/codex.tar.gz',
			mirrorUrl: 'https://mirror.invalid/codex.tar.gz',
			networkAvailable: false
		});
		assert.deepStrictEqual(source, {
			kind: 'bundled',
			path: '/app/runtimes/codex/0.128.0-linux-x64.tar.gz'
		});
	});

	test('reports unsupported offline platform clearly', () => {
		assert.throws(() => chooseAuraRuntimeSource({
			providerId: 'codex',
			platformKey: 'linux-arm64',
			version: '0.128.0',
			cachePath: '/cache/codex/0.128.0-linux-arm64.tar.gz',
			cacheExists: false,
			bundledPath: '/app/runtimes/codex/0.128.0-linux-arm64.tar.gz',
			bundledExists: false,
			officialUrl: '',
			mirrorUrl: '',
			networkAvailable: false
		}), /No Aura runtime source available for codex 0.128.0 linux-arm64/);
	});
});
```

- [ ] **步骤 2：运行测试，确认失败**

运行：`PATH="/usr/local/opt/node@22/bin:$PATH" npm run gulp -- compile-extension:our-remote-ssh && npx mocha --timeout 10000 --ui=tdd extensions/our-remote-ssh/src/test/auraRuntimeSource.test.js`

预期：compile 失败，错误包含 `Cannot find module '../../out/auraRuntimeSource'`。

- [ ] **步骤 3：编写最小实现**

在 `extensions/our-remote-ssh/src/auraRuntimeSource.ts` 写入：

```ts
export type AuraRuntimeSource =
	| { readonly kind: 'cache'; readonly path: string }
	| { readonly kind: 'download'; readonly url: string; readonly cachePath: string }
	| { readonly kind: 'bundled'; readonly path: string };

export interface AuraRuntimeSourceOptions {
	readonly providerId: string;
	readonly platformKey: string;
	readonly version: string;
	readonly cachePath: string;
	readonly cacheExists: boolean;
	readonly bundledPath: string;
	readonly bundledExists: boolean;
	readonly officialUrl: string;
	readonly mirrorUrl: string;
	readonly networkAvailable: boolean;
}

export function chooseAuraRuntimeSource(options: AuraRuntimeSourceOptions): AuraRuntimeSource {
	if (options.cacheExists) {
		return { kind: 'cache', path: options.cachePath };
	}
	if (options.networkAvailable && options.officialUrl) {
		return { kind: 'download', url: options.officialUrl, cachePath: options.cachePath };
	}
	if (options.networkAvailable && options.mirrorUrl) {
		return { kind: 'download', url: options.mirrorUrl, cachePath: options.cachePath };
	}
	if (options.bundledExists) {
		return { kind: 'bundled', path: options.bundledPath };
	}
	throw new Error(`No Aura runtime source available for ${options.providerId} ${options.version} ${options.platformKey}`);
}
```

- [ ] **步骤 4：运行测试，确认通过**

运行：`PATH="/usr/local/opt/node@22/bin:$PATH" npm run gulp -- compile-extension:our-remote-ssh && npx mocha --timeout 10000 --ui=tdd extensions/our-remote-ssh/src/test/auraRuntimeSource.test.js`

预期：测试进程退出码为 0。

- [ ] **步骤 5：提交**

```bash
git add extensions/our-remote-ssh/src/auraRuntimeSource.ts extensions/our-remote-ssh/src/test/auraRuntimeSource.test.js
git commit -m "feat: choose Aura runtime sources"
```

## Task 3: Remote Registry And Install Scripts

**Files:**
- 新建：`extensions/our-remote-ssh/src/auraRuntimeInstaller.ts`
- 新建：`extensions/our-remote-ssh/src/test/auraRuntimeInstaller.test.js`

- [ ] **步骤 1：编写失败测试**

```js
const assert = require('assert');
const {
	buildAuraRuntimeProbeScript,
	buildAuraRuntimeInstallScript,
	parseAuraRuntimeProbeOutput
} = require('../../out/auraRuntimeInstaller');

suite('Aura runtime installer scripts', () => {
	test('parses remote platform and existing registry', () => {
		const probe = parseAuraRuntimeProbeOutput([
			'aura-runtime-home=/home/user',
			'aura-runtime-os=linux',
			'aura-runtime-arch=x64',
			'aura-runtime-registry={"runtimes":{"codex":{"version":"0.128.0","binPath":"/home/user/.aura-code/runtimes/codex/0.128.0-linux-x64/bin/codex"}}}'
		].join('\\n'));
		assert.strictEqual(probe.home, '/home/user');
		assert.strictEqual(probe.platformKey, 'linux-x64');
		assert.strictEqual(probe.registry.runtimes.codex.version, '0.128.0');
	});

	test('probe script reads uname and registry file', () => {
		const script = buildAuraRuntimeProbeScript();
		assert.match(script, /uname -s/);
		assert.match(script, /uname -m/);
		assert.match(script, /\\.aura-code\\/runtimes\\/registry.json/);
	});

	test('install script validates sha256 and writes registry', () => {
		const script = buildAuraRuntimeInstallScript({
			providerId: 'codex',
			version: '0.128.0',
			platformKey: 'linux-x64',
			uploadPath: '/home/user/.aura-code/upload/codex.tar.gz',
			installDir: '/home/user/.aura-code/runtimes/codex/0.128.0-linux-x64',
			binRelativePath: 'bin/codex',
			sha256: '0000000000000000000000000000000000000000000000000000000000000000',
			sourceKind: 'bundled'
		});
		assert.match(script, /sha256sum/);
		assert.match(script, /tar -xzf/);
		assert.match(script, /bin\\/codex --version/);
		assert.match(script, /registry.json/);
		assert.match(script, /current/);
	});
});
```

- [ ] **步骤 2：运行测试，确认失败**

运行：`PATH="/usr/local/opt/node@22/bin:$PATH" npm run gulp -- compile-extension:our-remote-ssh && npx mocha --timeout 10000 --ui=tdd extensions/our-remote-ssh/src/test/auraRuntimeInstaller.test.js`

预期：compile 失败，错误包含 `Cannot find module '../../out/auraRuntimeInstaller'`。

- [ ] **步骤 3：编写最小实现**

在 `extensions/our-remote-ssh/src/auraRuntimeInstaller.ts` 写入 script builder 和 parser：

```ts
export interface AuraRuntimeRegistry {
	readonly runtimes: Record<string, {
		readonly version: string;
		readonly platformKey?: string;
		readonly binPath: string;
		readonly source?: string;
		readonly sha256?: string;
		readonly installedAt?: string;
	}>;
}

export interface AuraRuntimeRemoteProbe {
	readonly home: string;
	readonly os: string;
	readonly arch: string;
	readonly platformKey: string;
	readonly registry: AuraRuntimeRegistry;
}

export interface AuraRuntimeInstallScriptOptions {
	readonly providerId: string;
	readonly version: string;
	readonly platformKey: string;
	readonly uploadPath: string;
	readonly installDir: string;
	readonly binRelativePath: string;
	readonly sha256: string;
	readonly sourceKind: string;
}

export function buildAuraRuntimeProbeScript(): string {
	return `set -eu
home="$HOME"
os="$(uname -s | tr '[:upper:]' '[:lower:]')"
arch="$(uname -m)"
case "$arch" in
	x86_64) arch="x64" ;;
	aarch64|arm64) arch="arm64" ;;
esac
registry_path="$home/.aura-code/runtimes/registry.json"
echo "aura-runtime-home=$home"
echo "aura-runtime-os=$os"
echo "aura-runtime-arch=$arch"
if [ -f "$registry_path" ]; then
	printf 'aura-runtime-registry='
	cat "$registry_path"
	printf '\\n'
else
	echo 'aura-runtime-registry={"runtimes":{}}'
fi
`;
}

export function parseAuraRuntimeProbeOutput(output: string): AuraRuntimeRemoteProbe {
	const values = new Map<string, string>();
	for (const line of output.split(/\r?\n/)) {
		const index = line.indexOf('=');
		if (index > 0) {
			values.set(line.slice(0, index), line.slice(index + 1));
		}
	}
	const home = required(values, 'aura-runtime-home');
	const os = required(values, 'aura-runtime-os');
	const arch = required(values, 'aura-runtime-arch');
	const registry = JSON.parse(required(values, 'aura-runtime-registry')) as AuraRuntimeRegistry;
	return { home, os, arch, platformKey: `${os}-${arch}`, registry };
}

export function buildAuraRuntimeInstallScript(options: AuraRuntimeInstallScriptOptions): string {
	const marker = JSON.stringify({
		version: options.version,
		platformKey: options.platformKey,
		binPath: `${options.installDir}/${options.binRelativePath}`,
		source: options.sourceKind,
		sha256: options.sha256
	});
	return `set -eu
upload_path=${shellQuote(options.uploadPath)}
install_dir=${shellQuote(options.installDir)}
tmp_dir="$install_dir.tmp"
registry_path="$HOME/.aura-code/runtimes/registry.json"
provider_id=${shellQuote(options.providerId)}
expected_sha=${shellQuote(options.sha256)}
bin_relative=${shellQuote(options.binRelativePath)}
rm -rf "$tmp_dir"
mkdir -p "$tmp_dir" "$(dirname "$registry_path")"
if command -v sha256sum >/dev/null 2>&1; then
	actual_sha="$(sha256sum "$upload_path" | awk '{print $1}')"
elif command -v shasum >/dev/null 2>&1; then
	actual_sha="$(shasum -a 256 "$upload_path" | awk '{print $1}')"
else
	echo "aura-runtime-error missing-sha256-tool"
	exit 89
fi
if [ "$actual_sha" != "$expected_sha" ]; then
	echo "aura-runtime-error sha256-mismatch=$actual_sha"
	exit 87
fi
tar -xzf "$upload_path" -C "$tmp_dir"
if [ ! -x "$tmp_dir/$bin_relative" ]; then
	echo "aura-runtime-error missing-binary=$tmp_dir/$bin_relative"
	exit 88
fi
"$tmp_dir/$bin_relative" --version >/dev/null
rm -rf "$install_dir"
mv "$tmp_dir" "$install_dir"
ln -sfn "$(basename "$install_dir")" "$(dirname "$install_dir")/current"
node - "$registry_path" "$provider_id" <<'AURA_RUNTIME_NODE'
const fs = require('fs');
const registryPath = process.argv[2];
const providerId = process.argv[3];
const marker = ${JSON.stringify(marker)};
let registry = { runtimes: {} };
if (fs.existsSync(registryPath)) {
	registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
}
registry.runtimes[providerId] = { ...JSON.parse(marker), installedAt: new Date().toISOString() };
fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));
AURA_RUNTIME_NODE
rm -f "$upload_path"
echo "aura-runtime-install=ok"
`;
}

function required(values: Map<string, string>, key: string): string {
	const value = values.get(key);
	if (!value) {
		throw new Error(`Missing ${key} in Aura runtime probe output`);
	}
	return value;
}

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}
```

- [ ] **步骤 4：运行测试，确认通过**

运行：`PATH="/usr/local/opt/node@22/bin:$PATH" npm run gulp -- compile-extension:our-remote-ssh && npx mocha --timeout 10000 --ui=tdd extensions/our-remote-ssh/src/test/auraRuntimeInstaller.test.js`

预期：测试进程退出码为 0。

- [ ] **步骤 5：提交**

```bash
git add extensions/our-remote-ssh/src/auraRuntimeInstaller.ts extensions/our-remote-ssh/src/test/auraRuntimeInstaller.test.js
git commit -m "feat: add Aura remote runtime installer scripts"
```

## Task 4: Codex Provider And Wrapper Naming

**Files:**
- 新建：`extensions/our-remote-ssh/src/codexRuntimeProvider.ts`
- 新建：`extensions/our-remote-ssh/src/test/codexRuntimeProvider.test.js`
- 修改：`extensions/our-remote-ssh/src/codexUiWrapper.ts`
- 修改：`extensions/our-remote-ssh/src/test/codexUiWrapper.test.js`

- [ ] **步骤 1：编写失败测试**

```js
const assert = require('assert');
const {
	createCodexRuntimeInstallTarget,
	legacyCodexRemoteCliPath
} = require('../../out/codexRuntimeProvider');

suite('Codex runtime provider', () => {
	test('creates Aura Code install target for linux x64', () => {
		const target = createCodexRuntimeInstallTarget({
			home: '/home/user',
			platformKey: 'linux-x64',
			version: '0.128.0'
		});
		assert.strictEqual(target.installDir, '/home/user/.aura-code/runtimes/codex/0.128.0-linux-x64');
		assert.strictEqual(target.binPath, '/home/user/.aura-code/runtimes/codex/0.128.0-linux-x64/bin/codex');
		assert.strictEqual(target.uploadPath, '/home/user/.aura-code/upload/codex-0.128.0-linux-x64.tar.gz');
	});

	test('knows legacy remote path for compatibility', () => {
		assert.strictEqual(
			legacyCodexRemoteCliPath('/home/user', '0.128.0', 'linux-x64'),
			'/home/user/.remote-ai-server/codex/0.128.0-linux-x64/bin/codex'
		);
	});
});
```

同时在 `extensions/our-remote-ssh/src/test/codexUiWrapper.test.js` 增加：

```js
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
```

- [ ] **步骤 2：运行测试，确认失败**

运行：`PATH="/usr/local/opt/node@22/bin:$PATH" npm run gulp -- compile-extension:our-remote-ssh && npx mocha --timeout 10000 --ui=tdd extensions/our-remote-ssh/src/test/codexRuntimeProvider.test.js extensions/our-remote-ssh/src/test/codexUiWrapper.test.js`

预期：compile 失败，错误包含 `Cannot find module '../../out/codexRuntimeProvider'` 或 wrapper path 断言失败。

- [ ] **步骤 3：编写最小实现**

在 `extensions/our-remote-ssh/src/codexRuntimeProvider.ts` 写入：

```ts
import * as path from 'path';

export interface CodexRuntimeInstallTargetOptions {
	readonly home: string;
	readonly platformKey: string;
	readonly version: string;
}

export interface CodexRuntimeInstallTarget {
	readonly installDir: string;
	readonly binPath: string;
	readonly uploadPath: string;
	readonly binRelativePath: 'bin/codex';
}

export function createCodexRuntimeInstallTarget(options: CodexRuntimeInstallTargetOptions): CodexRuntimeInstallTarget {
	const installDir = path.posix.join(options.home, '.aura-code', 'runtimes', 'codex', `${options.version}-${options.platformKey}`);
	return {
		installDir,
		binPath: path.posix.join(installDir, 'bin', 'codex'),
		uploadPath: path.posix.join(options.home, '.aura-code', 'upload', `codex-${options.version}-${options.platformKey}.tar.gz`),
		binRelativePath: 'bin/codex'
	};
}

export function legacyCodexRemoteCliPath(home: string, version: string, platformKey: string): string {
	return path.posix.join(home, '.remote-ai-server', 'codex', `${version}-${platformKey}`, 'bin', 'codex');
}
```

在 `extensions/our-remote-ssh/src/codexUiWrapper.ts` 调整 prefix：

```ts
const wrapperDirName = 'codex-ui';
const wrapperPrefix = 'aura-code-codex-ssh-';
const legacyWrapperPrefix = 'remote-ai-codex-ssh-';

export function isManagedCodexSshWrapper(value: string | undefined): boolean {
	if (!value) {
		return false;
	}
	const basename = path.basename(value);
	return basename.startsWith(wrapperPrefix) || basename.startsWith(legacyWrapperPrefix);
}
```

- [ ] **步骤 4：运行测试，确认通过**

运行：`PATH="/usr/local/opt/node@22/bin:$PATH" npm run gulp -- compile-extension:our-remote-ssh && npx mocha --timeout 10000 --ui=tdd extensions/our-remote-ssh/src/test/codexRuntimeProvider.test.js extensions/our-remote-ssh/src/test/codexUiWrapper.test.js`

预期：测试进程退出码为 0。

- [ ] **步骤 5：提交**

```bash
git add extensions/our-remote-ssh/src/codexRuntimeProvider.ts extensions/our-remote-ssh/src/test/codexRuntimeProvider.test.js extensions/our-remote-ssh/src/codexUiWrapper.ts extensions/our-remote-ssh/src/test/codexUiWrapper.test.js
git commit -m "feat: add Codex Aura runtime provider"
```

## Task 5: Runtime Manager Integration In SSH Workspace

**Files:**
- 修改：`extensions/our-remote-ssh/src/extension.ts`
- 修改：`extensions/our-remote-ssh/package.json`
- 新建：`extensions/our-remote-ssh/src/test/auraRuntimeIntegration.test.js`

- [ ] **步骤 1：编写失败测试**

新建纯函数测试，避免直接 mock VS Code：

```js
const assert = require('assert');
const {
	createAuraRuntimeEnsurePlan
} = require('../../out/extension');

suite('Aura runtime integration', () => {
	test('uses existing remote registry Codex when version matches', () => {
		const plan = createAuraRuntimeEnsurePlan({
			providerId: 'codex',
			home: '/home/user',
			platformKey: 'linux-x64',
			configuredRemoteCliPath: '',
			registry: {
				runtimes: {
					codex: {
						version: '0.128.0',
						binPath: '/home/user/.aura-code/runtimes/codex/0.128.0-linux-x64/bin/codex'
					}
				}
			},
			requiredVersion: '0.128.0'
		});
		assert.deepStrictEqual(plan, {
			action: 'use-existing',
			binPath: '/home/user/.aura-code/runtimes/codex/0.128.0-linux-x64/bin/codex'
		});
	});

	test('respects explicit remoteCliPath configuration', () => {
		const plan = createAuraRuntimeEnsurePlan({
			providerId: 'codex',
			home: '/home/user',
			platformKey: 'linux-x64',
			configuredRemoteCliPath: '/custom/bin/codex',
			registry: { runtimes: {} },
			requiredVersion: '0.128.0'
		});
		assert.deepStrictEqual(plan, {
			action: 'use-configured',
			binPath: '/custom/bin/codex'
		});
	});

	test('plans install when registry is missing', () => {
		const plan = createAuraRuntimeEnsurePlan({
			providerId: 'codex',
			home: '/home/user',
			platformKey: 'linux-x64',
			configuredRemoteCliPath: '',
			registry: { runtimes: {} },
			requiredVersion: '0.128.0'
		});
		assert.strictEqual(plan.action, 'install');
		assert.strictEqual(plan.target.binPath, '/home/user/.aura-code/runtimes/codex/0.128.0-linux-x64/bin/codex');
	});
});
```

- [ ] **步骤 2：运行测试，确认失败**

运行：`PATH="/usr/local/opt/node@22/bin:$PATH" npm run gulp -- compile-extension:our-remote-ssh && npx mocha --timeout 10000 --ui=tdd extensions/our-remote-ssh/src/test/auraRuntimeIntegration.test.js`

预期：compile 失败，错误包含 `createAuraRuntimeEnsurePlan` is not exported。

- [ ] **步骤 3：编写最小实现**

在 `extensions/our-remote-ssh/src/extension.ts` 导出纯函数：

```ts
import { createCodexRuntimeInstallTarget, CodexRuntimeInstallTarget } from './codexRuntimeProvider';
import { AuraRuntimeRegistry } from './auraRuntimeInstaller';

export type AuraRuntimeEnsurePlan =
	| { readonly action: 'use-configured'; readonly binPath: string }
	| { readonly action: 'use-existing'; readonly binPath: string }
	| { readonly action: 'install'; readonly target: CodexRuntimeInstallTarget };

export function createAuraRuntimeEnsurePlan(options: {
	readonly providerId: 'codex';
	readonly home: string;
	readonly platformKey: string;
	readonly configuredRemoteCliPath: string;
	readonly registry: AuraRuntimeRegistry;
	readonly requiredVersion: string;
}): AuraRuntimeEnsurePlan {
	const configured = options.configuredRemoteCliPath.trim();
	if (configured) {
		return { action: 'use-configured', binPath: configured };
	}
	const existing = options.registry.runtimes[options.providerId];
	if (existing?.version === options.requiredVersion && existing.binPath) {
		return { action: 'use-existing', binPath: existing.binPath };
	}
	return {
		action: 'install',
		target: createCodexRuntimeInstallTarget({
			home: options.home,
			platformKey: options.platformKey,
			version: options.requiredVersion
		})
	};
}
```

再把 `configureCodexUiForWorkspace` 拆成两段：本地 workspace 仍清理 wrapper；SSH workspace 先调用 Runtime Manager。接入代码形状如下：

```ts
const probeResult = await sshExec(plan.host, buildAuraRuntimeProbeScript(), { sshPath: getSshConfiguration().get<string>('sshPath') || 'ssh' });
if (probeResult.code !== 0) {
	throw new Error(`Aura runtime probe failed\nstdout:\n${probeResult.stdout}\nstderr:\n${probeResult.stderr}`);
}
const probe = parseAuraRuntimeProbeOutput(probeResult.stdout);
const ensurePlan = createAuraRuntimeEnsurePlan({
	providerId: 'codex',
	home: probe.home,
	platformKey: probe.platformKey,
	configuredRemoteCliPath: codexConfiguration.get<string>('remoteCliPath') || '',
	registry: probe.registry,
	requiredVersion: defaultAuraRuntimeManifest.providers.codex.recommendedVersion
});
const remoteCliPath = ensurePlan.action === 'install'
	? ensurePlan.target.binPath
	: ensurePlan.binPath;
```

安装动作在 Task 6 接入。Task 5 只让 wrapper 使用新的 Aura Code 路径或显式配置路径。

在 `extensions/our-remote-ssh/package.json` 增加配置项：

```json
"aura.runtime.manifestPath": {
	"type": "string",
	"default": "",
	"description": "Local Aura Code runtime manifest path. Leave empty to use the bundled manifest."
},
"aura.runtime.bundledRoot": {
	"type": "string",
	"default": "",
	"description": "Local directory containing bundled Aura Code runtime tarballs. Leave empty to use the application resource directory."
},
"aura.runtime.networkEnabled": {
	"type": "boolean",
	"default": true,
	"description": "Allow Aura Code to download AI runtimes when local cache and bundled runtime packages are missing."
}
```

- [ ] **步骤 4：运行测试，确认通过**

运行：`PATH="/usr/local/opt/node@22/bin:$PATH" npm run gulp -- compile-extension:our-remote-ssh && npx mocha --timeout 10000 --ui=tdd extensions/our-remote-ssh/src/test/auraRuntimeIntegration.test.js`

预期：测试进程退出码为 0。

- [ ] **步骤 5：提交**

```bash
git add extensions/our-remote-ssh/src/extension.ts extensions/our-remote-ssh/package.json extensions/our-remote-ssh/src/test/auraRuntimeIntegration.test.js
git commit -m "feat: plan Codex runtime binding for SSH workspaces"
```

## Task 6: Upload, Install, Cache, And Download

**Files:**
- 修改：`extensions/our-remote-ssh/src/auraRuntimeSource.ts`
- 修改：`extensions/our-remote-ssh/src/auraRuntimeInstaller.ts`
- 修改：`extensions/our-remote-ssh/src/extension.ts`
- 修改：`extensions/our-remote-ssh/src/test/auraRuntimeSource.test.js`
- 修改：`extensions/our-remote-ssh/src/test/auraRuntimeInstaller.test.js`

- [ ] **步骤 1：编写失败测试**

在 `auraRuntimeSource.test.js` 增加：

```js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { hashAuraRuntimeFile } = require('../../out/auraRuntimeSource');

test('hashes runtime files with sha256', async () => {
	const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'aura-runtime-'));
	const file = path.join(dir, 'runtime.tar.gz');
	await fs.promises.writeFile(file, 'codex-runtime');
	const hash = await hashAuraRuntimeFile(file);
	assert.strictEqual(hash, 'fc8f82d54f407266e72d07b7222ccda5eccb619d5526cf84580c2a6ab6f2e772');
});
```

在 `auraRuntimeInstaller.test.js` 增加：

```js
const { createAuraRuntimeUploadPlan } = require('../../out/auraRuntimeInstaller');

test('creates remote upload plan under ~/.aura-code/upload', () => {
	const plan = createAuraRuntimeUploadPlan({
		home: '/home/user',
		providerId: 'codex',
		version: '0.128.0',
		platformKey: 'linux-x64'
	});
	assert.strictEqual(plan.remotePath, '/home/user/.aura-code/upload/codex-0.128.0-linux-x64.tar.gz');
	assert.match(plan.remoteCommand, /^mkdir -p/);
	assert.match(plan.remoteCommand, /cat >/);
});
```

- [ ] **步骤 2：运行测试，确认失败**

运行：`PATH="/usr/local/opt/node@22/bin:$PATH" npm run gulp -- compile-extension:our-remote-ssh && npx mocha --timeout 10000 --ui=tdd extensions/our-remote-ssh/src/test/auraRuntimeSource.test.js extensions/our-remote-ssh/src/test/auraRuntimeInstaller.test.js`

预期：compile 失败，错误包含 `hashAuraRuntimeFile` 或 `createAuraRuntimeUploadPlan` is not exported。

- [ ] **步骤 3：编写最小实现**

在 `auraRuntimeSource.ts` 增加 hash 和下载函数：

```ts
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as https from 'https';
import * as path from 'path';

export async function hashAuraRuntimeFile(filePath: string): Promise<string> {
	const hash = crypto.createHash('sha256');
	const stream = fs.createReadStream(filePath);
	for await (const chunk of stream) {
		hash.update(chunk);
	}
	return hash.digest('hex');
}

export async function downloadAuraRuntime(url: string, cachePath: string): Promise<string> {
	await fs.promises.mkdir(path.dirname(cachePath), { recursive: true });
	return new Promise((resolve, reject) => {
		const request = https.get(url, response => {
			if (response.statusCode !== 200) {
				reject(new Error(`Aura runtime download failed with HTTP ${response.statusCode}`));
				response.resume();
				return;
			}
			const output = fs.createWriteStream(cachePath);
			response.pipe(output);
			output.on('finish', () => output.close(() => resolve(cachePath)));
			output.on('error', reject);
		});
		request.on('error', reject);
	});
}
```

在 `auraRuntimeInstaller.ts` 增加上传 plan：

```ts
export interface AuraRuntimeUploadPlan {
	readonly remotePath: string;
	readonly remoteCommand: string;
}

export function createAuraRuntimeUploadPlan(options: {
	readonly home: string;
	readonly providerId: string;
	readonly version: string;
	readonly platformKey: string;
}): AuraRuntimeUploadPlan {
	const remotePath = `${options.home}/.aura-code/upload/${options.providerId}-${options.version}-${options.platformKey}.tar.gz`;
	return {
		remotePath,
		remoteCommand: `mkdir -p ${shellQuote(`${options.home}/.aura-code/upload`)} && cat > ${shellQuote(remotePath)}`
	};
}
```

在 `extension.ts` 的安装分支中执行：

```ts
if (ensurePlan.action === 'install') {
	const source = chooseAuraRuntimeSource({
		providerId: 'codex',
		platformKey: probe.platformKey,
		version: runtimePlatform.version,
		cachePath,
		cacheExists: await pathExists(cachePath),
		bundledPath,
		bundledExists: await pathExists(bundledPath),
		officialUrl: runtimePlatform.officialUrl,
		mirrorUrl: runtimePlatform.mirrorUrl,
		networkAvailable: runtimeConfiguration.get<boolean>('networkEnabled') ?? true
	});
	const localTarballPath = source.kind === 'download'
		? await downloadAuraRuntime(source.url, source.cachePath)
		: source.path;
	const actualSha256 = await hashAuraRuntimeFile(localTarballPath);
	if (runtimePlatform.sha256 !== '0000000000000000000000000000000000000000000000000000000000000000' && actualSha256 !== runtimePlatform.sha256) {
		throw new Error(`Aura runtime sha256 mismatch for ${localTarballPath}: ${actualSha256}`);
	}
	const upload = createAuraRuntimeUploadPlan({
		home: probe.home,
		providerId: 'codex',
		version: runtimePlatform.version,
		platformKey: probe.platformKey
	});
	const tarball = await fs.promises.readFile(localTarballPath);
	const uploadResult = await sshPipe(plan.host, upload.remoteCommand, { input: tarball, sshPath });
	if (uploadResult.code !== 0) {
		throw new Error(`Aura runtime upload failed\nstdout:\n${uploadResult.stdout}\nstderr:\n${uploadResult.stderr}`);
	}
	const installResult = await sshExec(plan.host, buildAuraRuntimeInstallScript({
		providerId: 'codex',
		version: runtimePlatform.version,
		platformKey: probe.platformKey,
		uploadPath: upload.remotePath,
		installDir: ensurePlan.target.installDir,
		binRelativePath: ensurePlan.target.binRelativePath,
		sha256: runtimePlatform.sha256,
		sourceKind: source.kind
	}), { sshPath, timeoutMs: 120_000 });
	if (installResult.code !== 0) {
		throw new Error(`Aura runtime install failed\nstdout:\n${installResult.stdout}\nstderr:\n${installResult.stderr}`);
	}
}
```

`pathExists` 在 `extension.ts` 中实现：

```ts
async function pathExists(filePath: string): Promise<boolean> {
	try {
		await fs.promises.access(filePath);
		return true;
	} catch {
		return false;
	}
}
```

- [ ] **步骤 4：运行测试，确认通过**

运行：`PATH="/usr/local/opt/node@22/bin:$PATH" npm run gulp -- compile-extension:our-remote-ssh && npx mocha --timeout 10000 --ui=tdd extensions/our-remote-ssh/src/test/auraRuntimeSource.test.js extensions/our-remote-ssh/src/test/auraRuntimeInstaller.test.js`

预期：测试进程退出码为 0。

- [ ] **步骤 5：提交**

```bash
git add extensions/our-remote-ssh/src/auraRuntimeSource.ts extensions/our-remote-ssh/src/auraRuntimeInstaller.ts extensions/our-remote-ssh/src/extension.ts extensions/our-remote-ssh/src/test/auraRuntimeSource.test.js extensions/our-remote-ssh/src/test/auraRuntimeInstaller.test.js
git commit -m "feat: install Aura Codex runtimes over SSH"
```

## Task 7: Bridge Default Path Migration

**Files:**
- 修改：`extensions/ai-codex-remote-bridge/src/codexCliInstaller.ts`
- 修改：`extensions/ai-codex-remote-bridge/src/remoteCodexRunner.ts`
- 修改：`extensions/ai-codex-remote-bridge/src/test/codexCliInstaller.test.js`
- 修改：`extensions/ai-codex-remote-bridge/src/test/remoteCodexRunner.test.js`

- [ ] **步骤 1：编写失败测试**

在 `codexCliInstaller.test.js` 修改默认路径断言：

```js
test('creates Aura Code install plan rooted in remote home', () => {
	const plan = createCodexCliInstallPlan('/home/user/.remote-ai-server/User/globalStorage/our.ai-codex-remote-bridge', 'linux', 'x64', '0.128.0', '/home/user');
	assert.strictEqual(plan.packageName, '@openai/codex@0.128.0-linux-x64');
	assert.strictEqual(plan.binPath, '/home/user/.aura-code/runtimes/codex/0.128.0-linux-x64/bin/codex');
	assert.strictEqual(plan.binaryRelativePath, 'bin/codex');
});
```

在 `remoteCodexRunner.test.js` 增加：

```js
test('resolves managed Aura Code path when remoteCliPath is empty', () => {
	const path = resolveRemoteCodexPath({
		remoteCliPath: '',
		globalStoragePath: '/home/user/.remote-ai-server/User/globalStorage/our.ai-codex-remote-bridge',
		platform: 'linux',
		arch: 'x64',
		home: '/home/user'
	});
	assert.strictEqual(path, '/home/user/.aura-code/runtimes/codex/0.128.0-linux-x64/bin/codex');
});
```

- [ ] **步骤 2：运行测试，确认失败**

运行：`PATH="/usr/local/opt/node@22/bin:$PATH" npm run gulp -- compile-extension:ai-codex-remote-bridge && npx mocha --timeout 10000 --ui=tdd extensions/ai-codex-remote-bridge/src/test/codexCliInstaller.test.js extensions/ai-codex-remote-bridge/src/test/remoteCodexRunner.test.js`

预期：断言失败，实际路径仍包含 `.remote-ai-server/User/globalStorage`。

- [ ] **步骤 3：编写最小实现**

更新 `codexCliInstaller.ts`：

```ts
export function createCodexCliInstallPlan(globalStoragePath: string, os: string, arch: string, version = defaultCodexCliVersion, home = process.env.HOME || ''): CodexCliInstallPlan {
	const platform = arch === 'x64' ? 'linux-x64' : arch === 'arm64' ? 'linux-arm64' : arch;
	const root = home ? toPosix(home) : toPosix(globalStoragePath);
	const installRoot = path.posix.join(root, '.aura-code', 'runtimes', 'codex', `${version}-${platform}`);
	return {
		packageName: codexPlatformPackage(os, arch, version),
		installRoot,
		binPath: path.posix.join(installRoot, 'bin', 'codex'),
		binaryRelativePath: 'bin/codex'
	};
}
```

更新 `remoteCodexRunner.ts` interface 和调用：

```ts
export interface RemoteCodexPathOptions {
	readonly remoteCliPath?: string;
	readonly globalStoragePath: string;
	readonly platform?: NodeJS.Platform;
	readonly arch?: string;
	readonly home?: string;
}

return createCodexCliInstallPlan(
	options.globalStoragePath,
	options.platform ?? process.platform,
	options.arch ?? process.arch,
	undefined,
	options.home ?? process.env.HOME
).binPath;
```

- [ ] **步骤 4：运行测试，确认通过**

运行：`PATH="/usr/local/opt/node@22/bin:$PATH" npm run gulp -- compile-extension:ai-codex-remote-bridge && npx mocha --timeout 10000 --ui=tdd extensions/ai-codex-remote-bridge/src/test/codexCliInstaller.test.js extensions/ai-codex-remote-bridge/src/test/remoteCodexRunner.test.js`

预期：测试进程退出码为 0。

- [ ] **步骤 5：提交**

```bash
git add extensions/ai-codex-remote-bridge/src/codexCliInstaller.ts extensions/ai-codex-remote-bridge/src/remoteCodexRunner.ts extensions/ai-codex-remote-bridge/src/test/codexCliInstaller.test.js extensions/ai-codex-remote-bridge/src/test/remoteCodexRunner.test.js
git commit -m "feat: use Aura runtime path for Codex bridge"
```

## Task 8: Release And Validation Wiring

**Files:**
- 修改：`scripts/remote-ai-validate.sh`
- 修改：`scripts/remote-ai-release-check.sh`
- 修改：`build/remote-ai/test/validateScript.test.js`
- 修改：`README.md`

- [ ] **步骤 1：编写失败测试**

在 `build/remote-ai/test/validateScript.test.js` 增加脚本文本断言：

```js
test('validate script configures Aura runtime fallback paths', () => {
	const script = fs.readFileSync(path.join(repoRoot, 'scripts/remote-ai-validate.sh'), 'utf8');
	assert.match(script, /aura\.runtime\.bundledRoot/);
	assert.match(script, /aura\.runtime\.networkEnabled/);
	assert.match(script, /0\.128\.0/);
});
```

- [ ] **步骤 2：运行测试，确认失败**

运行：`PATH="/usr/local/opt/node@22/bin:$PATH" npx mocha --timeout 10000 --ui=tdd build/remote-ai/test/validateScript.test.js`

预期：断言失败，输出包含 `aura.runtime.bundledRoot` 未匹配。

- [ ] **步骤 3：编写最小实现**

在 `scripts/remote-ai-validate.sh` 准备 settings 的位置加入：

```sh
"aura.runtime.bundledRoot": "$REPO_ROOT/resources/aura-code",
"aura.runtime.networkEnabled": true,
"aura.runtime.manifestPath": "$REPO_ROOT/resources/aura-code/runtime-manifest.json",
```

在 `scripts/remote-ai-release-check.sh` 的 release gate 中加入存在性检查：

```sh
if [ ! -f "$REPO_ROOT/resources/aura-code/runtime-manifest.json" ]; then
	echo "missing Aura runtime manifest: resources/aura-code/runtime-manifest.json" >&2
	exit 1
fi
```

在 README 的常用命令后追加验证说明：

```md
验证 Aura Code 离线兜底时，将 `aura.runtime.networkEnabled` 设置为 `false`，并确认 `resources/aura-code/runtimes/codex/0.128.0-linux-x64.tar.gz` 存在。
```

- [ ] **步骤 4：运行测试，确认通过**

运行：`PATH="/usr/local/opt/node@22/bin:$PATH" npx mocha --timeout 10000 --ui=tdd build/remote-ai/test/validateScript.test.js`

预期：测试进程退出码为 0。

- [ ] **步骤 5：提交**

```bash
git add scripts/remote-ai-validate.sh scripts/remote-ai-release-check.sh build/remote-ai/test/validateScript.test.js README.md
git commit -m "chore: wire Aura runtime validation settings"
```

## Task 9: Full Verification

**Files:**
- 修改：无新增源码，必要时只更新前面任务遗留的测试断言。

- [ ] **步骤 1：运行 TypeScript 编译**

运行：`PATH="/usr/local/opt/node@22/bin:$PATH" npm run compile`

预期：退出码为 0，输出不包含 TypeScript error。

- [ ] **步骤 2：运行扩展单元测试**

运行：`PATH="/usr/local/opt/node@22/bin:$PATH" npx mocha --timeout 10000 --ui=tdd extensions/our-remote-ssh/src/test/*.test.js extensions/ai-codex-remote-bridge/src/test/*.test.js`

预期：相关测试全部 PASS。

- [ ] **步骤 3：运行 release script 文本测试**

运行：`PATH="/usr/local/opt/node@22/bin:$PATH" npx mocha --timeout 10000 --ui=tdd build/remote-ai/test/validateScript.test.js`

预期：退出码为 0。

- [ ] **步骤 4：运行完整 release gate**

运行：

```bash
env -u ELECTRON_RUN_AS_NODE \
  REMOTE_AI_RELEASE_CHECK_E2E=1 \
  PATH="/usr/local/opt/node@22/bin:$PATH" \
  scripts/remote-ai-release-check.sh
```

预期：`releaseDoctor` 为 ok，GUI SSH E2E 和远端 Codex E2E 通过。

- [ ] **步骤 5：手工离线验证**

运行：

```bash
PATH="/usr/local/opt/node@22/bin:$PATH" scripts/remote-ai-validate.sh --prepare-only
```

然后在 settings 中临时设置：

```json
"aura.runtime.networkEnabled": false
```

打开 SSH 工作区后，在远端执行：

```sh
~/.aura-code/runtimes/codex/current/bin/codex --version
```

预期：输出包含 `0.128.0`，Codex 原生侧栏能在远端工作目录写入测试文件。

- [ ] **步骤 6：提交验证修正**

如果验证过程中只调整了测试或文档，运行：

```bash
git add README.md extensions/our-remote-ssh/src/test extensions/ai-codex-remote-bridge/src/test build/remote-ai/test/validateScript.test.js
git commit -m "test: verify Aura runtime manager"
```

如果没有额外改动，运行：

```bash
git status --short
```

预期：只剩用户已有的无关改动，或工作区干净。

## 自查

- Spec 覆盖：Task 1 覆盖 manifest；Task 2 覆盖 source 顺序；Task 3 覆盖远端 registry 和安装脚本；Task 4 覆盖 Codex provider 和 wrapper；Task 5 覆盖 SSH workspace 自动绑定；Task 6 覆盖上传、下载、缓存、离线兜底；Task 7 覆盖 bridge 默认路径迁移；Task 8 覆盖打包和验证入口；Task 9 覆盖完整验证。
- 本地工作区规则：Task 5 保留现有 `!plan` 分支清理 managed wrapper。
- 新电脑无网络规则：Task 2、Task 6、Task 8、Task 9 覆盖内置 Codex 0.128.x。
- Claude Code 预留：Task 1 的 provider manifest、Task 2 的通用 source、Task 3 的通用 installer 都不写死 Codex；Task 4 只放 Codex 专属逻辑。
- 兼容旧实现：Task 4 保留旧 wrapper prefix 识别；Task 5 尊重 `remoteai.codex.remoteCliPath`；Task 7 保留旧配置优先级。
