/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const fs = require('fs');
const path = require('path');

const CODEX_SECONDARY_SIDEBAR_CONTEXT = 'chatgpt.doesNotSupportSecondarySidebar';
const CODEX_PRIMARY_SIDEBAR_DISABLED_CONTEXT = 'chatgpt.forcePrimarySidebarDisabled';
const VERSION_GATE_PATTERN = /L0=\{major:1,minor:(\d+)\}/;
const JSON_RPC_WRITE_PATTERNS = ['JSON.stringify(e)+`\n`', 'JSON.stringify(e)+`\\n`'];
const REMOTE_WORKSPACE_CWD_MARKER = 'remoteAiWorkspaceCwd';
const AURA_CODEX_ICON_RELATIVE_PATH = 'resources/aura-codex.svg';
const AURA_CODEX_ICON_SOURCE_PATH = path.join(__dirname, 'assets', 'aura-codex.svg');

function patchCodexSecondarySidebarGate(source, supportedMinor = 105) {
	if (!source.includes(CODEX_SECONDARY_SIDEBAR_CONTEXT) || !VERSION_GATE_PATTERN.test(source)) {
		return { source, patched: false };
	}
	const next = source.replace(VERSION_GATE_PATTERN, `L0={major:1,minor:${supportedMinor}}`);
	return { source: next, patched: next !== source };
}

function patchCodexRemoteWorkspaceCwd(source) {
	const writePattern = JSON_RPC_WRITE_PATTERNS.find(pattern => source.includes(pattern));
	if (source.includes(REMOTE_WORKSPACE_CWD_MARKER) || !writePattern) {
		return { source, patched: false };
	}
	const sanitizer = '(()=>{try{const remoteAiWorkspaceCwd=df.workspace.workspaceFolders?.[0]?.uri;if(remoteAiWorkspaceCwd?.scheme==="vscode-remote"&&remoteAiWorkspaceCwd.fsPath){const r=JSON.parse(JSON.stringify(e)),n=new Set,o=i=>{if(!i||typeof i!="object"||n.has(i))return;n.add(i);if(typeof i.cwd==="string")i.cwd=remoteAiWorkspaceCwd.fsPath;for(const s of Object.values(i))o(s)};return o(r),r}}catch{}return e})()';
	const newlineSuffix = writePattern.slice('JSON.stringify(e)+'.length);
	const next = source.replace(writePattern, `JSON.stringify(${sanitizer})+${newlineSuffix}`);
	return { source: next, patched: next !== source };
}

function findCodexExtensionDirs(inputPath) {
	const resolved = path.resolve(inputPath);
	if (isCodexExtensionDir(resolved)) {
		return [resolved];
	}
	if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
		return [];
	}
	return fs.readdirSync(resolved)
		.map(name => path.join(resolved, name))
		.filter(isCodexExtensionDir);
}

function isCodexExtensionDir(extensionDir) {
	const packagePath = path.join(extensionDir, 'package.json');
	if (!fs.existsSync(packagePath)) {
		return false;
	}
	try {
		const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
		return pkg.publisher === 'openai'
			&& pkg.name === 'chatgpt'
			&& Boolean(pkg.contributes?.viewsContainers?.secondarySidebar);
	} catch {
		return false;
	}
}

function patchCodexPrimarySidebarFallback(pkg) {
	const activitybar = pkg.contributes?.viewsContainers?.activitybar;
	const secondarySidebar = pkg.contributes?.viewsContainers?.secondarySidebar;
	if (!Array.isArray(activitybar) || !Array.isArray(secondarySidebar)) {
		return { patched: false };
	}
	if (!secondarySidebar.some(container => container?.id === 'codexSecondaryViewContainer')) {
		return { patched: false };
	}

	let patched = false;
	for (const container of activitybar) {
		if (container?.id === 'codexViewContainer' && container.when !== CODEX_PRIMARY_SIDEBAR_DISABLED_CONTEXT) {
			container.when = CODEX_PRIMARY_SIDEBAR_DISABLED_CONTEXT;
			patched = true;
		}
	}
	return { patched };
}

function patchCodexActivityBarIcon(pkg) {
	const containers = [
		...(pkg.contributes?.viewsContainers?.activitybar ?? []),
		...(pkg.contributes?.viewsContainers?.secondarySidebar ?? [])
	];
	let patched = false;
	for (const container of containers) {
		if ((container?.id === 'codexViewContainer' || container?.id === 'codexSecondaryViewContainer')
			&& container.icon !== AURA_CODEX_ICON_RELATIVE_PATH) {
			container.icon = AURA_CODEX_ICON_RELATIVE_PATH;
			patched = true;
		}
	}
	return { patched };
}

function writeAuraCodexIcon(extensionDir) {
	const targetPath = path.join(extensionDir, AURA_CODEX_ICON_RELATIVE_PATH);
	const source = fs.readFileSync(AURA_CODEX_ICON_SOURCE_PATH, 'utf8');
	if (fs.existsSync(targetPath) && fs.readFileSync(targetPath, 'utf8') === source) {
		return false;
	}
	fs.mkdirSync(path.dirname(targetPath), { recursive: true });
	fs.writeFileSync(targetPath, source);
	return true;
}

function patchCodexExtensionDir(extensionDir, supportedMinor = 105) {
	const extensionJsPath = path.join(extensionDir, 'out', 'extension.js');
	const packagePath = path.join(extensionDir, 'package.json');
	let packagePatched = false;
	let iconPatched = false;
	if (fs.existsSync(packagePath)) {
		const packageSource = fs.readFileSync(packagePath, 'utf8');
		const pkg = JSON.parse(packageSource);
		const packagePatch = patchCodexPrimarySidebarFallback(pkg);
		const iconPatch = patchCodexActivityBarIcon(pkg);
		iconPatched = writeAuraCodexIcon(extensionDir);
		if (packagePatch.patched || iconPatch.patched) {
			const backupPath = `${packagePath}.remote-ai.bak`;
			if (!fs.existsSync(backupPath)) {
				fs.writeFileSync(backupPath, packageSource);
			}
			fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
			packagePatched = true;
		}
	}

	if (!fs.existsSync(extensionJsPath)) {
		return { extensionDir, patched: packagePatched || iconPatched, packagePatched, iconPatched, reason: 'missing extension.js' };
	}

	const source = fs.readFileSync(extensionJsPath, 'utf8');
	const gatePatch = patchCodexSecondarySidebarGate(source, supportedMinor);
	const cwdPatch = patchCodexRemoteWorkspaceCwd(gatePatch.source);
	if (!gatePatch.patched && !cwdPatch.patched) {
		return { extensionDir, patched: packagePatched || iconPatched, packagePatched, iconPatched, reason: 'already patched or unsupported bundle' };
	}

	const backupPath = `${extensionJsPath}.remote-ai.bak`;
	if (!fs.existsSync(backupPath)) {
		fs.writeFileSync(backupPath, source);
	}
	fs.writeFileSync(extensionJsPath, cwdPatch.source);
	return { extensionDir, patched: true, packagePatched, iconPatched, gatePatched: gatePatch.patched, cwdPatched: cwdPatch.patched, backupPath };
}

if (require.main === module) {
	const target = process.argv[2];
	if (!target) {
		process.stderr.write('Usage: node build/remote-ai/codexExtensionPatch.js <extensions-dir-or-openai.chatgpt-dir>\n');
		process.exitCode = 2;
	} else {
		const results = findCodexExtensionDirs(target).map(dir => patchCodexExtensionDir(dir));
		for (const result of results) {
			process.stdout.write(`${JSON.stringify(result)}\n`);
		}
		if (results.length === 0) {
			process.stdout.write(`${JSON.stringify({ patched: false, reason: 'no openai.chatgpt extension found', target: path.resolve(target) })}\n`);
		}
	}
}

module.exports = {
	AURA_CODEX_ICON_RELATIVE_PATH,
	findCodexExtensionDirs,
	patchCodexActivityBarIcon,
	patchCodexExtensionDir,
	patchCodexPrimarySidebarFallback,
	patchCodexRemoteWorkspaceCwd,
	patchCodexSecondarySidebarGate
};
