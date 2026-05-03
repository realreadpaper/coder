/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('assert');
const { renderDashboardHtml } = require('../../out/dashboardRenderer');

suite('RemoteAI dashboard renderer', () => {
	test('renders a CSP-protected dashboard with connection controls', () => {
		const html = renderDashboardHtml({
			nonce: 'nonce-1',
			initialHost: 'dev',
			initialRemotePath: '/home/user/project',
			serverTarballPath: '/tmp/server.tar.gz',
			commit: 'dev-compat',
			sshPath: 'ssh',
			auditPath: '/tmp/audit.jsonl',
			hostOptions: ['dev'],
			recentConnections: [{ host: 'dev', remotePath: '/home/user/project', lastUsed: 'now' }]
		});

		assert.match(html, /Content-Security-Policy/);
		assert.match(html, /nonce="nonce-1"/);
		assert.match(html, /name="host"/);
		assert.match(html, /name="remotePath"/);
		assert.match(html, /Step 1: SSH Host/);
		assert.match(html, /Step 2: Workspace Folder/);
		assert.match(html, /data-command="connect"/);
		assert.match(html, /data-command="browseRemoteFolder"/);
		assert.match(html, /data-command="diagnostics"/);
		assert.match(html, /type: 'browseRemoteFolder'/);
		assert.match(html, /type: 'diagnostics'/);
		assert.match(html, /datalist id="sshHosts"/);
		assert.match(html, /history-item/);
		assert.match(html, /RemoteAI SSH/);
		assert.match(html, /dev-compat/);
	});

	test('escapes user supplied values', () => {
		const html = renderDashboardHtml({
			nonce: 'nonce-1',
			initialHost: '<script>',
			initialRemotePath: '"/tmp',
			serverTarballPath: '',
			commit: '',
			sshPath: 'ssh',
			auditPath: ''
		});

		assert.doesNotMatch(html, /<script>/);
		assert.match(html, /&lt;script&gt;/);
		assert.match(html, /&quot;\/tmp/);
	});
});
