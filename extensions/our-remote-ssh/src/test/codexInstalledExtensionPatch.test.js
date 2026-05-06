/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
	patchInstalledCodexExtension
} = require('../../out/codexInstalledExtensionPatch');

suite('RemoteAI installed Codex extension patch', () => {
	let tempRoot;

	setup(() => {
		tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-codex-extension-'));
	});

	teardown(() => {
		fs.rmSync(tempRoot, { recursive: true, force: true });
	});

	test('forces installed Codex package contributions to the secondary sidebar only', () => {
		const extensionPath = createCodexExtension(tempRoot);

		const result = patchInstalledCodexExtension(extensionPath);
		const pkg = JSON.parse(fs.readFileSync(path.join(extensionPath, 'package.json'), 'utf8'));

		assert.strictEqual(result.patched, true);
		assert.strictEqual(pkg.contributes.viewsContainers.activitybar[0].when, 'chatgpt.forcePrimarySidebarDisabled');
		assert.strictEqual(pkg.contributes.viewsContainers.secondarySidebar[0].when, '!chatgpt.doesNotSupportSecondarySidebar');
	});

	test('removes Codex proposals unsupported by Aura 1.105', () => {
		const extensionPath = createCodexExtension(tempRoot);

		const result = patchInstalledCodexExtension(extensionPath);
		const pkg = JSON.parse(fs.readFileSync(path.join(extensionPath, 'package.json'), 'utf8'));

		assert.strictEqual(result.patched, true);
		assert.deepStrictEqual(pkg.enabledApiProposals, ['chatSessionsProvider']);
	});

	test('lowers the installed Codex secondary sidebar runtime gate for Aura 1.105', () => {
		const extensionPath = createCodexExtension(tempRoot);

		const result = patchInstalledCodexExtension(extensionPath);
		const source = fs.readFileSync(path.join(extensionPath, 'out', 'extension.js'), 'utf8');

		assert.strictEqual(result.patched, true);
		assert.match(source, /L0=\{major:1,minor:105\}/);
		assert.doesNotMatch(source, /L0=\{major:1,minor:106\}/);
	});

	test('allows Codex webview data fonts in the generated CSP', () => {
		const extensionPath = createCodexExtension(tempRoot);

		patchInstalledCodexExtension(extensionPath);
		const source = fs.readFileSync(path.join(extensionPath, 'out', 'extension.js'), 'utf8');

		assert.match(source, /`font-src \$\{e\.cspSource\} data:`/);
		assert.doesNotMatch(source, /`font-src \$\{e\.cspSource\}`/);
	});

	test('routes remote absolute file reads through the active remote workspace URI', () => {
		const extensionPath = createCodexExtension(tempRoot);

		patchInstalledCodexExtension(extensionPath);
		const source = fs.readFileSync(path.join(extensionPath, 'out', 'extension.js'), 'utf8');

		assert.match(source, /i\.uri\.scheme!==["']file["']/);
		assert.match(source, /i\.uri\.with\(\{path:r,query:"",fragment:""\}\)/);
	});

	test('short-circuits Codex webview Statsig telemetry fetches locally', () => {
		const extensionPath = createCodexExtension(tempRoot);

		patchInstalledCodexExtension(extensionPath);
		const source = fs.readFileSync(path.join(extensionPath, 'out', 'extension.js'), 'utf8');

		assert.match(source, /ab\.chatgpt\.com/);
		assert.match(source, /\/ces\//);
		assert.match(source, /\\"has_updates\\":true/);
		assert.match(source, /\\"feature_gates\\":\{\}/);
		assert.match(source, /\\"dynamic_configs\\":\{\}/);
		assert.match(source, /\\"layer_configs\\":\{\}/);
		assert.match(source, /async stream\(e,r\)\{let o=W0\(e\.url\),i=await this\.authProvider\.getToken/);
	});

	test('short-circuits Codex webview relative WHAM usage telemetry locally', () => {
		const extensionPath = createCodexExtension(tempRoot);

		patchInstalledCodexExtension(extensionPath);
		const source = fs.readFileSync(path.join(extensionPath, 'out', 'extension.js'), 'utf8');

		assert.match(source, /o===["']\/wham\/usage["']/);
		assert.match(source, /o\.startsWith\(["']\/wham\/["']\)/);
		assert.match(source, /bodyJsonString:"\{\}"/);
		assert.match(source, /async stream\(e,r\)\{let o=W0\(e\.url\),i=await this\.authProvider\.getToken/);
	});
});

function createCodexExtension(root) {
	const extensionPath = path.join(root, 'openai.chatgpt-26.5429.30905');
	fs.mkdirSync(path.join(extensionPath, 'out'), { recursive: true });
	fs.writeFileSync(path.join(extensionPath, 'package.json'), `${JSON.stringify({
		publisher: 'openai',
		name: 'chatgpt',
		enabledApiProposals: ['chatSessionsProvider', 'languageModelProxy'],
		contributes: {
			viewsContainers: {
				activitybar: [{ id: 'codexViewContainer', when: 'chatgpt.doesNotSupportSecondarySidebar' }],
				secondarySidebar: [{ id: 'codexSecondaryViewContainer', when: '!chatgpt.doesNotSupportSecondarySidebar' }]
			}
		}
	}, null, 2)}\n`);
	fs.writeFileSync(path.join(extensionPath, 'out', 'extension.js'), [
		'var L0={major:1,minor:106},XQ="chatgpt.doesNotSupportSecondarySidebar";function n_(t){}',
		'async function fO({raw:t,readUri:e}){let r=t.replace(/^([ab])[\\\\/]/,"");if(sn.isAbsolute(r))try{return await e(Ve.Uri.file(r))}catch{}let o=await Xte(r,Array.from(Ve.workspace.workspaceFolders??[])).reduce(async(i,s)=>{let a=await i;if(a!=null)return a;try{return await e(s)}catch{return null}},Promise.resolve(null));if(o!=null)return o;if(r.length>0)try{let i=`**/${r.replace(/\\\\/g,"/")}`,s=await Ve.workspace.findFiles(i,void 0,1);if(s.length>0)return await e(s[0])}catch{}throw new Error(`Unable to read file: ${t}`)}',
		'function getWebviewContentProduction(e){let c=["default-src \'none\'",`img-src ${e.cspSource} https: data: blob:`,`script-src ${e.cspSource}`,`style-src ${e.cspSource} \'unsafe-inline\'`,`font-src ${e.cspSource}`,`connect-src ${e.cspSource} ${Bqe}`].join("; ")+";";return c}',
		'async fetch(e,r){try{if(e.url.startsWith(h7)){return{type:"fetch-response",responseType:"success",requestId:e.requestId,status:200,headers:{},bodyJsonString:"{}"}}let o=W0(e.url),i=await this.authProvider.getToken({refreshToken:!1});return i}catch(n){return X().error("Error fetching",{safe:{url:e.url,error:n},sensitive:{}}),{type:"fetch-response",responseType:"error",requestId:e.requestId,status:433,error:n instanceof Error?n.message:"Unknown error"}}}',
		'async stream(e,r){let o=W0(e.url),i=await this.authProvider.getToken({refreshToken:!1});return i}'
	].join('\n'));
	return extensionPath;
}
