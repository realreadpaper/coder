/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import { requestApproval } from './approvalClient';
import { createAppendPatchPreview } from './codexPatchPreview';
import { WorkspaceSandbox } from './workspaceSandbox';

export interface CodexAppendPatchOptions {
	readonly relativePath?: string;
	readonly appendText?: string;
}

export interface CodexPatchResult {
	readonly path: string;
	readonly bytesWritten: number;
	readonly diff: string;
}

export async function applyCodexAppendPatch(workspaceRoot: string, options: CodexAppendPatchOptions = {}): Promise<CodexPatchResult> {
	const relativePath = options.relativePath ?? 'README.md';
	const appendText = options.appendText ?? `\nRemoteAI Codex approved edit ${new Date().toISOString()}\n`;
	const target = path.join(workspaceRoot, relativePath);
	const sandbox = new WorkspaceSandbox(workspaceRoot);
	await sandbox.assertInside(target);
	const original = await fs.promises.readFile(target, 'utf8');
	const diff = createAppendPatchPreview(relativePath, original, appendText);

	await requestApproval({
		id: `codex-append-${Date.now()}`,
		operation: 'applyPatch',
		title: `Approve Codex patch for ${relativePath}?`,
		resource: target,
		diff,
		metadata: { relativePath }
	});

	const next = `${original}${appendText}`;
	await fs.promises.writeFile(target, next, 'utf8');
	return { path: target, bytesWritten: Buffer.byteLength(next), diff };
}

export { createAppendPatchPreview };
