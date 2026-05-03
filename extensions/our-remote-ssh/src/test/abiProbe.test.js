/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('assert');
const { maxRequiredGlibc, maxRequiredGlibcxx, isAbiAllowed } = require('../../out/abiProbe');

suite('RemoteAI ABI probe', () => {
	test('extracts max GLIBC version', () => {
		const output = 'Name: GLIBC_2.2.5\nName: GLIBC_2.17\nName: GLIBC_2.14';
		assert.strictEqual(maxRequiredGlibc(output), '2.17');
	});

	test('extracts max GLIBCXX version', () => {
		const output = 'Name: GLIBCXX_3.4\nName: GLIBCXX_3.4.18\nName: GLIBCXX_3.4.19';
		assert.strictEqual(maxRequiredGlibcxx(output), '3.4.19');
	});

	test('allows CentOS 7 proven ABI', () => {
		assert.strictEqual(isAbiAllowed({ glibc: '2.17', glibcxx: '3.4.19' }, { glibc: '2.17', glibcxx: '3.4.19' }), true);
	});

	test('blocks binaries requiring newer libstdc++', () => {
		assert.strictEqual(isAbiAllowed({ glibc: '2.17', glibcxx: '3.4.19' }, { glibc: '2.17', glibcxx: '3.4.25' }), false);
	});
});
