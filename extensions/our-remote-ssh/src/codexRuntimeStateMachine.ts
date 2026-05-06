/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export type CodexRuntimeStage =
	| 'probe'
	| 'select'
	| 'fetch'
	| 'install'
	| 'verify'
	| 'bind'
	| 'syncCredentials';

export type CodexRuntimeStageStatus = 'started' | 'succeeded' | 'failed';

export interface CodexRuntimeMarker {
	readonly host: string;
	readonly remotePath: string;
	readonly stage: CodexRuntimeStage;
	readonly status: CodexRuntimeStageStatus;
	readonly updatedAt: string;
	readonly details?: Record<string, unknown>;
	readonly error?: string;
}

export interface CodexRuntimeStateMachineOptions {
	readonly host: string;
	readonly remotePath: string;
	readonly markerPath: string;
	readonly now?: () => string;
	readonly onTransition?: (marker: CodexRuntimeMarker) => void | Promise<void>;
}

export class CodexRuntimeStateMachine {
	private readonly now: () => string;

	constructor(private readonly options: CodexRuntimeStateMachineOptions) {
		this.now = options.now ?? (() => new Date().toISOString());
	}

	async runStage<T>(
		stage: CodexRuntimeStage,
		details: Record<string, unknown>,
		run: () => Promise<T>
	): Promise<T> {
		await this.writeTransition(stage, 'started', details);
		try {
			const result = await run();
			await this.writeTransition(stage, 'succeeded', details);
			return result;
		} catch (error) {
			await this.writeTransition(stage, 'failed', details, error instanceof Error ? error.message : String(error));
			throw error;
		}
	}

	private async writeTransition(
		stage: CodexRuntimeStage,
		status: CodexRuntimeStageStatus,
		details: Record<string, unknown>,
		error?: string
	): Promise<void> {
		const marker: CodexRuntimeMarker = {
			host: this.options.host,
			remotePath: this.options.remotePath,
			stage,
			status,
			updatedAt: this.now(),
			details,
			...(error ? { error } : {})
		};
		await fs.promises.mkdir(path.dirname(this.options.markerPath), { recursive: true });
		const tmpPath = `${this.options.markerPath}.tmp.${process.pid}`;
		await fs.promises.writeFile(tmpPath, `${JSON.stringify(marker, null, 2)}\n`, 'utf8');
		await fs.promises.rename(tmpPath, this.options.markerPath);
		await this.options.onTransition?.(marker);
	}
}

export function createCodexRuntimeMarkerPath(globalStoragePath: string, host: string, remotePath: string): string {
	const hostKey = host.replace(/[^a-zA-Z0-9._-]/g, '_');
	const digest = crypto.createHash('sha256').update(`${host}\0${remotePath}`).digest('hex').slice(0, 16);
	return path.join(globalStoragePath, 'codex-runtime-state', `${hostKey}-${digest}.json`);
}
