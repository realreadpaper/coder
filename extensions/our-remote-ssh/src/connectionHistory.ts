/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface ConnectionHistoryEntry {
	readonly host: string;
	readonly remotePath: string;
	readonly lastUsed: string;
}

export function updateConnectionHistory(
	existing: readonly ConnectionHistoryEntry[],
	entry: ConnectionHistoryEntry,
	limit = 10
): ConnectionHistoryEntry[] {
	return [
		entry,
		...existing.filter(item => item.host !== entry.host)
	].slice(0, limit);
}
