/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export interface ApprovalRequest {
	readonly id?: string;
	readonly operation?: string;
	readonly title?: string;
	readonly cwd?: string;
	readonly command?: string;
	readonly resource?: string;
	readonly diff?: string;
	readonly metadata?: Record<string, unknown>;
}

export function activate(context: vscode.ExtensionContext): void {
	const output = vscode.window.createOutputChannel('RemoteAI Approval');
	context.subscriptions.push(output);

	context.subscriptions.push(vscode.commands.registerCommand('remoteai.approval.request', async (request: ApprovalRequest = {}) => {
		const title = request.title || `Approve RemoteAI ${request.operation || 'operation'}?`;
		const detail = renderRequestDetail(request);
		const approved = await vscode.window.showWarningMessage(title, { modal: true, detail }, 'Approve', 'Reject') === 'Approve';
		output.appendLine(JSON.stringify({
			timestamp: new Date().toISOString(),
			id: request.id,
			operation: request.operation,
			resource: request.resource,
			cwd: request.cwd,
			approved
		}));
		return approved;
	}));
}

export function deactivate(): void { }

function renderRequestDetail(request: ApprovalRequest): string {
	const lines = [];
	if (request.command) {
		lines.push(`Command: ${request.command}`);
	}
	if (request.cwd) {
		lines.push(`CWD: ${request.cwd}`);
	}
	if (request.resource) {
		lines.push(`Resource: ${request.resource}`);
	}
	if (request.diff) {
		lines.push(`Diff:\n${truncate(request.diff, 4000)}`);
	}
	return lines.join('\n');
}

function truncate(value: string, maxLength: number): string {
	if (value.length <= maxLength) {
		return value;
	}
	return `${value.slice(0, maxLength)}\n... truncated ...`;
}
