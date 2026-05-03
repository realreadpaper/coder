/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export function createAppendPatchPreview(relativePath: string, original: string, appendText: string): string {
	const originalLines = original.endsWith('\n') ? original.slice(0, -1).split('\n') : original.split('\n');
	const appendedLines = appendText.replace(/^\n/, '').replace(/\n$/, '').split('\n').filter(line => line.length > 0);
	const context = originalLines.slice(-5).map(line => ` ${line}`);
	const additions = appendedLines.map(line => `+${line}`);
	return [
		`--- ${relativePath}`,
		`+++ ${relativePath}`,
		'@@ append @@',
		...context,
		...additions
	].join('\n');
}
