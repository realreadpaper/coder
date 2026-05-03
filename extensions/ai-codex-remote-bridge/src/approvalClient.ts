/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export type ApprovalOperation = 'write' | 'applyPatch' | 'delete' | 'exec' | 'network';

export interface ApprovalRequest {
	readonly id: string;
	readonly operation: ApprovalOperation;
	readonly title: string;
	readonly cwd?: string;
	readonly command?: string;
	readonly resource?: string;
	readonly diff?: string;
	readonly metadata?: Record<string, unknown>;
}

export async function requestApproval(request: ApprovalRequest): Promise<void> {
	const approved = await vscode.commands.executeCommand<boolean>('remoteai.approval.request', request);
	if (!approved) {
		throw new Error(`RemoteAI approval rejected: ${request.operation}`);
	}
}
