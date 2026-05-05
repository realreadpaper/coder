# RemoteAI GitHub Release

This repository publishes RemoteAI through GitHub Actions.

## Security Gate

`.github/workflows/remote-ai-security.yml` runs on pull requests and pushes to `main` or `release/*`.

It enforces:

- CodeQL JavaScript/TypeScript analysis.
- Dependency review on pull requests, failing high severity dependency changes.
- RemoteAI extension compile.
- RemoteAI unit tests.
- `npm audit --omit=dev --audit-level=critical`.
- `git diff --check`.

## Release Trigger

The current release line is `v0.1`.

Publish from GitHub:

1. Create a GitHub Release for tag `v0.1`.
2. Publish it.
3. The `Aura Release` workflow builds and uploads the installers to that Release.

Pushing a version tag is also supported:

```sh
git tag v0.1
git push origin v0.1
```

Tag pushes create a draft GitHub Release by default so artifacts can be reviewed before publishing.

The release workflow does not package first. It runs CodeQL and the RemoteAI gate before producing artifacts. Packaging jobs are blocked if either gate fails.

Manual release is also supported from the GitHub Actions page:

- Workflow: `RemoteAI Release`
- Input `release_tag`: version tag, default `v0.1`
- Input `draft`: keep enabled until final manual review

## Produced Artifacts

The release workflow uploads:

- `aura-remote-server`: Linux x64 remote server bundle and a platform-named SHA256 file.
- `aura-darwin-x64`: unsigned macOS x64 app zip, unsigned `.dmg`, and a platform-named SHA256 file.
- `aura-darwin-arm64`: unsigned macOS arm64 app zip, unsigned `.dmg`, and a platform-named SHA256 file.
- `aura-linux-x64`: Linux x64 tarball, `.deb`, `.rpm`, and a platform-named SHA256 file.
- `aura-win32-x64`: Windows x64 user setup `.exe`, app zip, and a platform-named SHA256 file.

The remote server package is built by `scripts/remote-ai-package-release.sh`, then verified by `build/remote-ai/releaseDoctor.js`.

The macOS app package is built by `scripts/remote-ai-package-darwin.sh` from the Aura darwin gulp build. Linux and Windows packages are built from the corresponding `vscode-linux-x64-min` and `vscode-win32-x64-min` gulp outputs. Every desktop package includes the bundled remote server release and `resources/aura-code` runtime bundle.

## Local Dry Run

Package the remote server from an existing REH tree:

```sh
REMOTE_AI_RELEASE_SKIP_REH_BUILD=1 \
REMOTE_AI_SERVER_SOURCE=../vscode-reh-linux-x64 \
REMOTE_AI_RELEASE_COMMIT=dev-compat \
scripts/remote-ai-package-release.sh
```

Package the macOS app from an existing app build:

```sh
REMOTE_AI_DARWIN_SKIP_BUILD=1 \
REMOTE_AI_DARWIN_APP_ROOT=../VSCode-darwin-arm64 \
VSCODE_ARCH=arm64 \
scripts/remote-ai-package-darwin.sh
```

## Signing And Notarization

The current workflow intentionally publishes unsigned macOS artifacts. A notarized public release requires Apple credentials that cannot be verified locally without real secrets:

- Apple Developer ID Application certificate exported as a password-protected `.p12`.
- Certificate password.
- Apple Team ID.
- Apple ID or App Store Connect API credentials.
- App-specific password or API key material.

Do not mark a release as non-draft until either:

- unsigned artifacts are explicitly acceptable for the target audience, or
- a signing/notarization job has been added and has passed on the release tag.

## Release Review Checklist

Before publishing the draft release:

- Confirm `RemoteAI Security` passed for the tag commit.
- Confirm `RemoteAI Release` passed.
- Download `manifest.json` and verify it points to the expected commit.
- Confirm the platform-named SHA256 files contain the uploaded installers.
- Run the app manually and connect to `ssh dev` with `scripts/remote-ai-validate.sh` if this is a user-facing build.
