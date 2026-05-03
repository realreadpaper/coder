# RemoteAI Basic Usage

This fork implements Remote-SSH as a Code-OSS secondary development, not as a separate IDE or SFTP browser.

## Implemented Path

1. Build or prepare a compatible `vscode-reh-linux-x64.tar.gz`.
2. Configure the UI extension:
   - `remoteai.ssh.serverTarballPath`: local tarball path.
   - `remoteai.ssh.commit`: remote server install directory name.
   - `remoteai.ssh.sshPath`: OpenSSH binary, default `ssh`.
   - `remoteai.ssh.defaultRemotePath`: folder shown by the connect command.
3. Run `RemoteAI: Open SSH Dashboard` for the graphical connection console, or use `RemoteAI: Connect to SSH Host` / `Remote-SSH: Connect to Host` for the command-palette flow.
4. The resolver bootstraps `ssh-remote+HOST`, installs `~/.remote-ai-server/bin/COMMIT`, starts `bin/remote-ai-server`, opens an SSH local forward, and returns `ResolvedAuthority`.
5. Code-OSS then uses the normal VS Code remote stack: remote FileService, remote Extension Host, terminals, search, Git, LSP and debug run against the remote server.

## Codex Extension Support

The OpenAI Codex VS Code extension is still a VS Code extension. This fork supports it by:

- Enabling required proposed API entries for `openai.chatgpt` in `product.json`.
- Setting `extensionKindOverrides.openai.chatgpt` to allow UI and workspace execution.
- Adding `our.ai-codex-remote-bridge` as a workspace extension that runs in the remote Extension Host.
- Selecting Linux Codex CLI packages by remote OS/arch, rejecting local macOS CLI reuse.
- Adding `our.ai-approval-ui` as a UI extension for approval requests.
- Enforcing remote workspace path checks through `WorkspaceSandbox` before AI file operations are wired to writes or commands.

The bridge does not copy or modify the Codex extension. It provides the remote-side guardrails and platform selection needed for Codex to operate on the remote workspace through normal VS Code APIs.

## Server Packaging

Use:

```sh
node build/remote-ai/packageServer.js \
  --source ../vscode-reh-linux-x64 \
  --commit dev-compat \
  --release-dir remote-releases/dev-compat \
  --compat-server-source ../remote-server/extracted/vscode-reh-linux-x64 \
  --min-glibc 2.17 \
  --include-extension extensions/ai-codex-remote-bridge
```

The generated `remote-releases/` directory is intentionally ignored by git. The packaging script writes a `manifest.json`, computes sha256, can overlay Linux Node and native `.node` modules from a compatible Cursor/REH server tree for CentOS 7 compatibility, and disables macOS AppleDouble metadata in tarballs.

Before publishing or handing a package to a tester, run:

```sh
node build/remote-ai/releaseDoctor.js remote-releases/dev-compat/manifest.json
```

The command fails if the tarball is missing, the manifest sha256/size does not match, or required server entries such as `node`, `bin/remote-ai-server`, `out/server-main.js`, and `product.json` are absent.

## Release Gate

Use the release gate before publishing a build:

```sh
scripts/remote-ai-release-check.sh
```

It runs `releaseDoctor`, full source compile, the RemoteAI unit test set, and `git diff --check`. GUI/SSH E2E is opt-in because it requires a desktop session and access to `ssh dev`:

```sh
REMOTE_AI_RELEASE_CHECK_E2E=1 scripts/remote-ai-release-check.sh
```

For a quick rerun after a full compile has already passed:

```sh
REMOTE_AI_RELEASE_CHECK_COMPILE=0 scripts/remote-ai-release-check.sh
```

GitHub security and release automation is documented in `docs/remote-ai-github-release.md`.

## Local Validation Launcher

Use the wrapper script for manual validation from sources:

```sh
scripts/remote-ai-validate.sh
```

It prepares `/tmp/remote-ai-validate-user-data`, checks the release manifest with `releaseDoctor`, prepares `/home/hejianglong/remote-ai-manual` on `ssh dev`, and starts Code-OSS through `scripts/code.sh` with the required development environment. Do not use `open -n .build/electron/Code - OSS.app` for source builds; that path can start Electron without the Code-OSS development bootstrap and show a black window.

Use `--prepare-only` when you only want to refresh settings and remote fixtures:

```sh
scripts/remote-ai-validate.sh --prepare-only
```

## Diagnostics

Run `RemoteAI: Show Diagnostics` from the command palette, or click `Diagnostics` in the RemoteAI SSH Dashboard. The generated Markdown report includes:

- App name, app commit, current remote name, and workspace folders.
- SSH binary, default remote path, server manifest, tarball override, parsed SSH hosts, and recent connections.
- Release manifest status, selected tarball path, sha256, size, and minimum glibc metadata.
- Audit log path and manifest errors, if any.

## Verified Evidence

Fresh local verification on May 3, 2026:

```sh
node ./node_modules/gulp/bin/gulp.js \
  compile-extension:our-remote-ssh \
  compile-extension:ai-codex-remote-bridge \
  compile-extension:ai-approval-ui

npx mocha --timeout 10000 --ui=tdd \
  build/remote-ai/test/*.test.js \
  extensions/our-remote-ssh/src/test/*.test.js \
  extensions/ai-codex-remote-bridge/src/test/*.test.js
```

Current verified release checks:

```sh
node build/remote-ai/releaseDoctor.js remote-releases/dev-compat/manifest.json

node ./node_modules/gulp/bin/gulp.js \
  compile-extension:our-remote-ssh \
  compile-extension:ai-codex-remote-bridge \
  compile-extension:ai-approval-ui

npx mocha --timeout 10000 --ui=tdd \
  build/remote-ai/test/*.test.js \
  extensions/our-remote-ssh/src/test/*.test.js \
  extensions/ai-codex-remote-bridge/src/test/*.test.js

node test/remote-ai/e2e/remoteAiFullE2E.js
```

Fresh result on May 3, 2026:

- `npm run compile`: passed with 0 errors.
- RemoteAI unit tests: 53 passing.
- `releaseDoctor`: passed for `remote-releases/dev-compat/manifest.json`.
- GUI/SSH E2E against `ssh dev`: passed.
- `git diff --check`: passed.

Fresh `ssh dev` verification installed and launched:

```json
{
  "commit": "dev-compat-smoke-1777786535816",
  "serverDir": "/home/hejianglong/.remote-ai-server/bin/dev-compat-smoke-1777786535816",
  "endpoint": { "host": "127.0.0.1", "port": 44121 },
  "localPort": 52857
}
```

Remote facts verified:

- Bundled Node: `v20.18.2`.
- Remote glibc: `ldd (GNU libc) 2.17`.
- `extensions/ai-codex-remote-bridge/package.json` exists in the installed server.
- No `._*` AppleDouble files were present in the installed bridge.
- Audit hash-chain recorded bootstrap, install, launch and tunnel events through `tunnel.open/succeeded`.
