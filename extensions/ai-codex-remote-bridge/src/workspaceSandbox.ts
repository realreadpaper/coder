/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';

export class WorkspaceSandbox {
	private rootRealPath: Promise<string>;

	constructor(workspaceRoot: string) {
		this.rootRealPath = fs.promises.realpath(workspaceRoot);
	}

	async assertInside(candidate: string): Promise<string> {
		const [root, target] = await Promise.all([
			this.rootRealPath,
			fs.promises.realpath(candidate)
		]);
		if (!isEqualOrChild(root, target)) {
			throw new Error(`Path is outside workspace: ${candidate}`);
		}
		return target;
	}

	async assertParentInside(candidate: string): Promise<string> {
		const parent = path.dirname(candidate);
		await this.assertInside(parent);
		return candidate;
	}
}

function isEqualOrChild(root: string, target: string): boolean {
	const relative = path.relative(root, target);
	return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
