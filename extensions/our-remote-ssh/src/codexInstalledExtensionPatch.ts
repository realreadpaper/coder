/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';

const codexSecondarySidebarContext = 'chatgpt.doesNotSupportSecondarySidebar';
const codexPrimarySidebarDisabledContext = 'chatgpt.forcePrimarySidebarDisabled';
const versionGatePattern = /L0=\{major:1,minor:(\d+)\}/;
const supportedCodexApiProposals = new Set(['chatSessionsProvider']);
const codexWebviewFontCspPattern = '`font-src ${e.cspSource}`';
const codexWebviewFontCspReplacement = '`font-src ${e.cspSource} data:`';
const codexAbsoluteReadPattern = 'if(sn.isAbsolute(r))try{return await e(Ve.Uri.file(r))}catch{}';
const codexAbsoluteReadReplacement = 'if(sn.isAbsolute(r)){try{return await e(Ve.Uri.file(r))}catch{}for(let i of Array.from(Ve.workspace.workspaceFolders??[]))if(i.uri.scheme!=="file")try{return await e(i.uri.with({path:r,query:"",fragment:""}))}catch{}}';
const codexFetchTelemetryPattern = 'let o=W0(e.url),i=await this.authProvider.getToken({refreshToken:!1})';
const codexEmptyJsonBodyLiteral = JSON.stringify('{}');
const codexStatsigInitializeBodyLiteral = JSON.stringify(JSON.stringify({
	has_updates: true,
	time: 1,
	feature_gates: {},
	dynamic_configs: {},
	layer_configs: {},
	param_stores: {},
	exposures: {},
	sdk_flags: {},
	user: {}
}));
const codexFetchTelemetryReplacement = `let o=W0(e.url);if(o==="/wham/usage"||o.startsWith("/wham/"))return{type:"fetch-response",responseType:"success",requestId:e.requestId,status:200,headers:{"content-type":"application/json"},bodyJsonString:${codexEmptyJsonBodyLiteral}};try{let i=new URL(o),s=i.hostname.toLowerCase(),a=i.pathname;if(s==="ab.chatgpt.com"||s==="chatgpt.com"&&a.startsWith("/ces/"))return{type:"fetch-response",responseType:"success",requestId:e.requestId,status:200,headers:{"content-type":"application/json"},bodyJsonString:${codexStatsigInitializeBodyLiteral}}}catch{}let i=await this.authProvider.getToken({refreshToken:!1})`;

export interface InstalledCodexExtensionPatchResult {
	readonly extensionPath: string;
	readonly patched: boolean;
	readonly packagePatched: boolean;
	readonly bundlePatched: boolean;
	readonly reason?: string;
}

export function patchInstalledCodexExtension(extensionPath: string): InstalledCodexExtensionPatchResult {
	const packagePath = path.join(extensionPath, 'package.json');
	const bundlePath = path.join(extensionPath, 'out', 'extension.js');
	let packagePatched = false;
	let bundlePatched = false;

	if (!fs.existsSync(packagePath)) {
		return { extensionPath, patched: false, packagePatched, bundlePatched, reason: 'missing package.json' };
	}

	const packageSource = fs.readFileSync(packagePath, 'utf8');
	const pkg = JSON.parse(packageSource);
	if (pkg.publisher !== 'openai' || pkg.name !== 'chatgpt') {
		return { extensionPath, patched: false, packagePatched, bundlePatched, reason: 'not openai.chatgpt' };
	}

	const sidebarPatched = patchCodexPackageSecondarySidebar(pkg);
	const proposalsPatched = patchCodexPackageApiProposals(pkg);
	if (sidebarPatched || proposalsPatched) {
		writeBackupOnce(packagePath, packageSource);
		fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
		packagePatched = true;
	}

	if (fs.existsSync(bundlePath)) {
		const bundleSource = fs.readFileSync(bundlePath, 'utf8');
		const bundleNext = patchCodexBundle(bundleSource);
		if (bundleNext !== bundleSource) {
			writeBackupOnce(bundlePath, bundleSource);
			fs.writeFileSync(bundlePath, bundleNext);
			bundlePatched = true;
		}
	}

	return {
		extensionPath,
		patched: packagePatched || bundlePatched,
		packagePatched,
		bundlePatched,
		reason: packagePatched || bundlePatched ? undefined : 'already patched or unsupported bundle'
	};
}

export function patchCodexPackageSecondarySidebar(pkg: any): boolean {
	const activitybar = pkg.contributes?.viewsContainers?.activitybar;
	const secondarySidebar = pkg.contributes?.viewsContainers?.secondarySidebar;
	if (!Array.isArray(activitybar) || !Array.isArray(secondarySidebar)) {
		return false;
	}
	if (!secondarySidebar.some(container => container?.id === 'codexSecondaryViewContainer')) {
		return false;
	}

	let patched = false;
	for (const container of activitybar) {
		if (container?.id === 'codexViewContainer' && container.when !== codexPrimarySidebarDisabledContext) {
			container.when = codexPrimarySidebarDisabledContext;
			patched = true;
		}
	}
	for (const container of secondarySidebar) {
		if (container?.id === 'codexSecondaryViewContainer' && container.when !== `!${codexSecondarySidebarContext}`) {
			container.when = `!${codexSecondarySidebarContext}`;
			patched = true;
		}
	}
	return patched;
}

export function patchCodexPackageApiProposals(pkg: any): boolean {
	if (!Array.isArray(pkg.enabledApiProposals)) {
		return false;
	}
	const next = pkg.enabledApiProposals.filter((proposal: unknown) => typeof proposal === 'string' && supportedCodexApiProposals.has(proposal));
	if (next.length === pkg.enabledApiProposals.length && next.every((proposal: string, index: number) => proposal === pkg.enabledApiProposals[index])) {
		return false;
	}
	pkg.enabledApiProposals = next;
	return true;
}

export function patchCodexBundleSecondarySidebarGate(source: string, supportedMinor = 105): string {
	if (!source.includes(codexSecondarySidebarContext) || !versionGatePattern.test(source)) {
		return source;
	}
	return source.replace(versionGatePattern, `L0={major:1,minor:${supportedMinor}}`);
}

export function patchCodexBundle(source: string): string {
	let next = patchCodexBundleSecondarySidebarGate(source);
	next = replaceAll(next, codexWebviewFontCspPattern, codexWebviewFontCspReplacement);
	next = replaceAll(next, codexAbsoluteReadPattern, codexAbsoluteReadReplacement);
	next = replaceFirst(next, codexFetchTelemetryPattern, codexFetchTelemetryReplacement);
	return next;
}

function replaceAll(source: string, search: string, replacement: string): string {
	return source.split(search).join(replacement);
}

function replaceFirst(source: string, search: string, replacement: string): string {
	const index = source.indexOf(search);
	if (index === -1) {
		return source;
	}
	return `${source.slice(0, index)}${replacement}${source.slice(index + search.length)}`;
}

function writeBackupOnce(filePath: string, source: string): void {
	const backupPath = `${filePath}.remote-ai.bak`;
	if (!fs.existsSync(backupPath)) {
		fs.writeFileSync(backupPath, source);
	}
}
