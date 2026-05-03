# RemoteAI Remote Server Smoke

Use this after creating a `vscode-reh-linux-x64.tar.gz` artifact:

```sh
mkdir -p /tmp/remote-ai-smoke
tar -xzf remote-releases/dev-compat/vscode-reh-linux-x64.tar.gz -C /tmp/remote-ai-smoke
sh test/remote-ai/smoke/remoteServerSmoke.sh /tmp/remote-ai-smoke/vscode-reh-linux-x64
```

On macOS the smoke checks package structure and executable bits. On Linux it also executes the bundled `node`, which is the ABI-sensitive part for CentOS 7 compatibility.
