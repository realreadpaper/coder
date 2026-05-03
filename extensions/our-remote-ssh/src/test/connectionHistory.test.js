/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('assert');
const { updateConnectionHistory } = require('../../out/connectionHistory');

suite('RemoteAI connection history', () => {
	test('stores most recent connection first and de-duplicates', () => {
		const history = updateConnectionHistory([
			{ host: 'dev', remotePath: '/a', lastUsed: 'old' }
		], { host: 'dev', remotePath: '/b', lastUsed: 'new' });

		assert.deepStrictEqual(history, [
			{ host: 'dev', remotePath: '/b', lastUsed: 'new' }
		]);
	});

	test('keeps bounded history', () => {
		const existing = Array.from({ length: 12 }, (_, index) => ({ host: `h${index}`, remotePath: '/', lastUsed: String(index) }));
		const history = updateConnectionHistory(existing, { host: 'new', remotePath: '/', lastUsed: 'now' });
		assert.strictEqual(history.length, 10);
		assert.strictEqual(history[0].host, 'new');
	});
});
