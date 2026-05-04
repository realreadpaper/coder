/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('assert');
const {
	buildAuraRuntimeProbeScript,
	buildAuraRuntimeInstallScript,
	parseAuraRuntimeProbeOutput
} = require('../../out/auraRuntimeInstaller');

suite('Aura runtime installer scripts', () => {
	test('parses remote platform and existing registry', () => {
		const probe = parseAuraRuntimeProbeOutput([
			'aura-runtime-home=/home/user',
			'aura-runtime-os=linux',
			'aura-runtime-arch=x64',
			'aura-runtime-registry={"runtimes":{"codex":{"version":"0.128.0","binPath":"/home/user/.aura-code/runtimes/codex/0.128.0-linux-x64/bin/codex"}}}'
		].join('\n'));
		assert.strictEqual(probe.home, '/home/user');
		assert.strictEqual(probe.platformKey, 'linux-x64');
		assert.strictEqual(probe.registry.runtimes.codex.version, '0.128.0');
	});

	test('probe script reads uname and registry file', () => {
		const script = buildAuraRuntimeProbeScript();
		assert.match(script, /uname -s/);
		assert.match(script, /uname -m/);
		assert.match(script, /\.aura-code\/runtimes\/registry.json/);
	});

	test('install script validates sha256 and writes registry', () => {
		const script = buildAuraRuntimeInstallScript({
			providerId: 'codex',
			version: '0.128.0',
			platformKey: 'linux-x64',
			uploadPath: '/home/user/.aura-code/upload/codex.tar.gz',
			installDir: '/home/user/.aura-code/runtimes/codex/0.128.0-linux-x64',
			binRelativePath: 'bin/codex',
			sha256: '0000000000000000000000000000000000000000000000000000000000000000',
			sourceKind: 'bundled'
		});
		assert.match(script, /sha256sum/);
		assert.match(script, /tar -xzf/);
		assert.match(script, /"\$tmp_dir\/\$bin_relative" --version/);
		assert.match(script, /registry.json/);
		assert.match(script, /current/);
	});
});
