/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export type AuditStatus = 'started' | 'approved' | 'rejected' | 'succeeded' | 'failed';

export interface AuditLogContext {
	readonly sessionId: string;
	readonly actor: string;
}

export interface AuditLogEvent {
	readonly operation: string;
	readonly status: AuditStatus;
	readonly authority?: string;
	readonly workspaceRoot?: string;
	readonly resource?: string;
	readonly metadata?: Record<string, unknown>;
}

interface AuditLogRecord extends AuditLogContext, AuditLogEvent {
	readonly eventId: string;
	readonly sequence: number;
	readonly timestamp: string;
	readonly previousHash: string | null;
	readonly hash: string;
}

export class AuditLogWriter {
	private sequence = 0;
	private previousHash: string | null = null;

	constructor(
		private readonly filePath: string,
		private readonly context: AuditLogContext
	) { }

	async record(event: AuditLogEvent): Promise<AuditLogRecord> {
		await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
		await this.loadLastRecord();

		const baseRecord = {
			...this.context,
			...event,
			eventId: crypto.randomUUID(),
			sequence: this.sequence + 1,
			timestamp: new Date().toISOString(),
			previousHash: this.previousHash
		};
		const hash = this.hashRecord(baseRecord);
		const record: AuditLogRecord = { ...baseRecord, hash };
		await fs.promises.appendFile(this.filePath, `${JSON.stringify(record)}\n`, 'utf8');
		this.sequence = record.sequence;
		this.previousHash = record.hash;
		return record;
	}

	private async loadLastRecord(): Promise<void> {
		if (this.sequence > 0) {
			return;
		}

		let content: string;
		try {
			content = await fs.promises.readFile(this.filePath, 'utf8');
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
				return;
			}
			throw error;
		}

		const lines = content.trim().split('\n').filter(Boolean);
		if (lines.length === 0) {
			return;
		}

		const lastRecord = JSON.parse(lines[lines.length - 1]) as AuditLogRecord;
		this.sequence = lastRecord.sequence;
		this.previousHash = lastRecord.hash;
	}

	private hashRecord(record: Omit<AuditLogRecord, 'hash'>): string {
		return crypto.createHash('sha256').update(JSON.stringify(record)).digest('hex');
	}
}
