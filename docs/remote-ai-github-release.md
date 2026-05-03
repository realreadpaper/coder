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

Push a version tag:

```sh
git tag v0.1.0
git push origin v0.1.0
```

The release workflow creates a draft GitHub Release by default.

The release workflow does not package first. It runs CodeQL and the RemoteAI gate before producing artifacts. Packaging jobs are blocked if either gate fails.

Manual release is also supported from the GitHub Actions page:

- Workflow: `RemoteAI Release`
- Input `release_tag`: version tag, for example `v0.1.0`
- Input `draft`: keep enabled until final manual review

## Produced Artifacts

The release workflow uploads:

- `remote-ai-server`: Linux x64 RemoteAI server tarball, `manifest.json`, and `SHA256SUMS`.
- `remote-ai-darwin-arm64-unsigned`: unsigned macOS arm64 app zip and `SHA256SUMS`.

The remote server package is built by `scripts/remote-ai-package-release.sh`, then verified by `build/remote-ai/releaseDoctor.js`.

The macOS app package is built by `scripts/remote-ai-package-darwin.sh` from the existing Code-OSS darwin gulp build.

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
- Confirm `SHA256SUMS` contains the uploaded tarball and app zip.
- Run the app manually and connect to `ssh dev` with `scripts/remote-ai-validate.sh` if this is a user-facing build.
