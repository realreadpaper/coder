/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface DashboardRenderOptions {
	readonly nonce: string;
	readonly initialHost: string;
	readonly initialRemotePath: string;
	readonly serverTarballPath: string;
	readonly commit: string;
	readonly sshPath: string;
	readonly auditPath: string;
	readonly hostOptions?: readonly string[];
	readonly recentConnections?: readonly { host: string; remotePath: string; lastUsed: string }[];
}

export function renderDashboardHtml(options: DashboardRenderOptions): string {
	const host = escapeHtml(options.initialHost);
	const remotePath = escapeHtml(options.initialRemotePath);
	const serverTarballPath = escapeHtml(options.serverTarballPath || 'Not configured');
	const commit = escapeHtml(options.commit || 'dev');
	const sshPath = escapeHtml(options.sshPath || 'ssh');
	const auditPath = escapeHtml(options.auditPath || 'Not available');
	const nonce = escapeAttribute(options.nonce);
	const hostOptions = [...new Set([...(options.hostOptions ?? []), ...(options.recentConnections ?? []).map(entry => entry.host)])].map(hostOption => `<option value="${escapeAttribute(hostOption)}"></option>`).join('');
	const recentConnections = (options.recentConnections ?? []).map(entry => `<button class="history-item" type="button" data-host="${escapeAttribute(entry.host)}" data-path="${escapeAttribute(entry.remotePath)}">${escapeHtml(entry.host)} <span>${escapeHtml(entry.remotePath)}</span></button>`).join('');

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Aura SSH</title>
	<style nonce="${nonce}">
		:root {
			color-scheme: light dark;
			--surface: var(--vscode-editor-background);
			--panel: var(--vscode-sideBar-background);
			--panel-border: var(--vscode-panel-border);
			--text: var(--vscode-foreground);
			--muted: var(--vscode-descriptionForeground);
			--accent: var(--vscode-button-background);
			--accent-text: var(--vscode-button-foreground);
			--input: var(--vscode-input-background);
			--input-border: var(--vscode-input-border);
			--focus: var(--vscode-focusBorder);
		}
		* {
			box-sizing: border-box;
		}
		body {
			margin: 0;
			background: var(--surface);
			color: var(--text);
			font-family: var(--vscode-font-family);
			font-size: var(--vscode-font-size);
			line-height: 1.45;
		}
		.shell {
			width: min(980px, 100%);
			margin: 0 auto;
			padding: 28px 24px 32px;
		}
		header {
			display: flex;
			align-items: flex-start;
			justify-content: space-between;
			gap: 20px;
			padding-bottom: 22px;
			border-bottom: 1px solid var(--panel-border);
		}
		h1 {
			margin: 0;
			font-size: 24px;
			font-weight: 650;
			letter-spacing: 0;
		}
		.status {
			display: inline-flex;
			align-items: center;
			gap: 8px;
			min-height: 28px;
			padding: 4px 10px;
			border: 1px solid var(--panel-border);
			border-radius: 8px;
			color: var(--muted);
			white-space: nowrap;
		}
		.status-dot {
			width: 8px;
			height: 8px;
			border-radius: 50%;
			background: var(--accent);
		}
		main {
			display: grid;
			grid-template-columns: minmax(0, 1.2fr) minmax(280px, 0.8fr);
			gap: 18px;
			margin-top: 22px;
		}
		.panel {
			border: 1px solid var(--panel-border);
			border-radius: 8px;
			background: var(--panel);
			padding: 18px;
		}
		.panel h2 {
			margin: 0 0 16px;
			font-size: 15px;
			font-weight: 650;
			letter-spacing: 0;
		}
		.form-grid {
			display: grid;
			gap: 14px;
		}
		.step {
			display: grid;
			gap: 10px;
			padding: 12px;
			border: 1px solid var(--panel-border);
			border-radius: 8px;
		}
		.step-title {
			color: var(--text);
			font-size: 13px;
			font-weight: 650;
		}
		label {
			display: grid;
			gap: 6px;
			color: var(--muted);
			font-size: 12px;
			font-weight: 600;
		}
		input {
			width: 100%;
			min-height: 34px;
			border: 1px solid var(--input-border);
			border-radius: 6px;
			background: var(--input);
			color: var(--text);
			padding: 7px 10px;
			font: inherit;
		}
		input:focus {
			outline: 1px solid var(--focus);
			outline-offset: 1px;
		}
		.actions {
			display: flex;
			flex-wrap: wrap;
			gap: 10px;
			margin-top: 16px;
		}
		button {
			min-height: 34px;
			border: 1px solid transparent;
			border-radius: 6px;
			padding: 0 14px;
			font: inherit;
			font-weight: 600;
			cursor: pointer;
		}
		button.primary {
			background: var(--accent);
			color: var(--accent-text);
		}
		button.secondary {
			background: transparent;
			border-color: var(--panel-border);
			color: var(--text);
		}
		.meta {
			display: grid;
			gap: 12px;
		}
		.meta-row {
			display: grid;
			gap: 4px;
			padding-bottom: 12px;
			border-bottom: 1px solid var(--panel-border);
		}
		.meta-row:last-child {
			border-bottom: 0;
			padding-bottom: 0;
		}
		.meta-key {
			color: var(--muted);
			font-size: 12px;
			font-weight: 600;
		}
		.meta-value {
			overflow-wrap: anywhere;
		}
		.message {
			min-height: 24px;
			margin-top: 14px;
			color: var(--muted);
		}
		.history {
			display: grid;
			gap: 8px;
			margin-top: 16px;
		}
		.history-item {
			display: flex;
			justify-content: space-between;
			gap: 10px;
			width: 100%;
			background: transparent;
			border-color: var(--panel-border);
			color: var(--text);
			text-align: left;
		}
		.history-item span {
			color: var(--muted);
			overflow-wrap: anywhere;
		}
		@media (max-width: 760px) {
			.shell {
				padding: 20px 16px 24px;
			}
			header {
				display: grid;
			}
			main {
				grid-template-columns: 1fr;
			}
			.status {
				width: fit-content;
			}
		}
	</style>
</head>
<body>
	<div class="shell">
		<header>
			<div>
				<h1>Aura SSH</h1>
			</div>
			<div class="status" aria-live="polite">
				<span class="status-dot"></span>
				<span id="statusText">Ready</span>
			</div>
		</header>
		<main>
			<section class="panel" aria-labelledby="connectionTitle">
				<h2 id="connectionTitle">Connection</h2>
				<form id="connectForm" class="form-grid">
					<div class="step">
						<div class="step-title">Step 1: SSH Host</div>
						<label>
							Host
							<input name="host" value="${host}" list="sshHosts" autocomplete="off" spellcheck="false">
							<datalist id="sshHosts">${hostOptions}</datalist>
						</label>
					</div>
					<div class="step">
						<div class="step-title">Step 2: Workspace Folder</div>
						<label>
							Remote Folder
							<input name="remotePath" value="${remotePath}" autocomplete="off" spellcheck="false">
						</label>
						<div class="actions">
							<button class="secondary" type="button" data-command="browseRemoteFolder">Browse Folders</button>
						</div>
					</div>
					<div class="actions">
						<button class="primary" type="submit" data-command="connect">Connect</button>
						<button class="secondary" type="button" data-command="chooseTarball">Select Server Tarball</button>
						<button class="secondary" type="button" data-command="diagnostics">Diagnostics</button>
					</div>
				</form>
				<div class="history" aria-label="Recent connections">${recentConnections}</div>
				<div id="message" class="message" aria-live="polite"></div>
			</section>
			<aside class="panel" aria-labelledby="serverTitle">
				<h2 id="serverTitle">Server</h2>
				<div class="meta">
					<div class="meta-row">
						<div class="meta-key">Commit</div>
						<div class="meta-value">${commit}</div>
					</div>
					<div class="meta-row">
						<div class="meta-key">SSH Binary</div>
						<div class="meta-value">${sshPath}</div>
					</div>
					<div class="meta-row">
						<div class="meta-key">Server Tarball</div>
						<div class="meta-value" id="tarballPath">${serverTarballPath}</div>
					</div>
					<div class="meta-row">
						<div class="meta-key">Audit Log</div>
						<div class="meta-value">${auditPath}</div>
					</div>
				</div>
			</aside>
		</main>
	</div>
	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		const form = document.getElementById('connectForm');
		const statusText = document.getElementById('statusText');
		const message = document.getElementById('message');
		const tarballPath = document.getElementById('tarballPath');

		form.addEventListener('submit', event => {
			event.preventDefault();
			const data = new FormData(form);
			statusText.textContent = 'Connecting';
			message.textContent = '';
			vscode.postMessage({
				type: 'connect',
				host: String(data.get('host') || '').trim(),
				remotePath: String(data.get('remotePath') || '').trim()
			});
		});

		document.querySelector('[data-command="chooseTarball"]').addEventListener('click', () => {
			vscode.postMessage({ type: 'chooseTarball' });
		});
		document.querySelector('[data-command="browseRemoteFolder"]').addEventListener('click', () => {
			const data = new FormData(form);
			vscode.postMessage({
				type: 'browseRemoteFolder',
				host: String(data.get('host') || '').trim(),
				remotePath: String(data.get('remotePath') || '').trim()
			});
		});
		document.querySelector('[data-command="diagnostics"]').addEventListener('click', () => {
			vscode.postMessage({ type: 'diagnostics' });
		});

		for (const item of document.querySelectorAll('.history-item')) {
			item.addEventListener('click', () => {
				form.elements.host.value = item.dataset.host || '';
				form.elements.remotePath.value = item.dataset.path || '';
			});
		}

		window.addEventListener('message', event => {
			const msg = event.data || {};
			if (msg.type === 'status') {
				statusText.textContent = msg.status || 'Ready';
				message.textContent = msg.message || '';
			}
			if (msg.type === 'tarballSelected') {
				tarballPath.textContent = msg.path || 'Not configured';
			}
			if (msg.type === 'remoteFolderSelected') {
				form.elements.remotePath.value = msg.path || '';
			}
		});
	</script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function escapeAttribute(value: string): string {
	return escapeHtml(value).replace(/`/g, '&#96;');
}
