/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const fs = require('fs');
const path = require('path');

const CODEX_SECONDARY_SIDEBAR_CONTEXT = 'chatgpt.doesNotSupportSecondarySidebar';
const VERSION_GATE_PATTERN = /L0=\{major:1,minor:(\d+)\}/;

function patchCodexSecondarySidebarGate(source, supportedMinor = 105) {
	if (!source.includes(CODEX_SECONDARY_SIDEBAR_CONTEXT) || !VERSION_GATE_PATTERN.test(source)) {
		return { source, patched: false };
	}
	const next = source.replace(VERSION_GATE_PATTERN, `L0={major:1,minor:${supportedMinor}}`);
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

function patchCodexExtensionDir(extensionDir, supportedMinor = 105) {
	const extensionJsPath = path.join(extensionDir, 'out', 'extension.js');
	if (!fs.existsSync(extensionJsPath)) {
		return { extensionDir, patched: false, reason: 'missing extension.js' };
	}

	const source = fs.readFileSync(extensionJsPath, 'utf8');
	const result = patchCodexSecondarySidebarGate(source, supportedMinor);
	if (!result.patched) {
		return { extensionDir, patched: false, reason: 'already patched or unsupported bundle' };
	}

	const backupPath = `${extensionJsPath}.remote-ai.bak`;
	if (!fs.existsSync(backupPath)) {
		fs.writeFileSync(backupPath, source);
	}
	fs.writeFileSync(extensionJsPath, result.source);
	return { extensionDir, patched: true, backupPath };
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
	findCodexExtensionDirs,
	patchCodexExtensionDir,
	patchCodexSecondarySidebarGate
};
