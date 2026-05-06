/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import product from '../../../product/common/product.js';
import { IProductService } from '../../../product/common/productService.js';
import { getRemoteAuthorityPrefix, RemoteAuthorityResolverError, RemoteAuthorityResolverErrorCode, WebSocketRemoteConnection } from '../../common/remoteAuthorityResolver.js';
import { RemoteAuthorityResolverService } from '../../electron-browser/remoteAuthorityResolverService.js';

suite('RemoteAuthorityResolverService', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('issue #147318: RemoteAuthorityResolverError keeps the same type', async () => {
		const productService: IProductService = { _serviceBrand: undefined, ...product };
		const service = new RemoteAuthorityResolverService(productService, undefined as any);
		const result = service.resolveAuthority('test+x');
		service._setResolvedAuthorityError('test+x', new RemoteAuthorityResolverError('something', RemoteAuthorityResolverErrorCode.TemporarilyNotAvailable));
		try {
			await result;
			assert.fail();
		} catch (err) {
			assert.strictEqual(RemoteAuthorityResolverError.isTemporarilyNotAvailable(err), true);
		}
		service.dispose();
	});

	test('gets resolver prefix when remote separator is URI encoded', () => {
		assert.strictEqual(getRemoteAuthorityPrefix('ssh-remote%2Bdev'), 'ssh-remote');
		assert.strictEqual(getRemoteAuthorityPrefix('ssh-remote%2bdev'), 'ssh-remote');
	});

	test('resolves encoded and decoded authorities through the same request', async () => {
		const productService: IProductService = { _serviceBrand: undefined, ...product };
		const service = new RemoteAuthorityResolverService(productService, undefined as any);
		const result = service.resolveAuthority('ssh-remote%2Bdev');

		service._setResolvedAuthority({
			authority: 'ssh-remote+dev',
			connectTo: new WebSocketRemoteConnection('127.0.0.1', 1234),
			connectionToken: 'token'
		});

		assert.strictEqual((await result).authority.authority, 'ssh-remote+dev');
		assert.ok(service.getConnectionData('ssh-remote%2Bdev'));
		service.dispose();
	});
});
