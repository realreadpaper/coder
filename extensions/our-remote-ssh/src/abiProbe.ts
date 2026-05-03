/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface AbiVersion {
	readonly glibc: string;
	readonly glibcxx: string;
}

export function maxRequiredGlibc(readelfOutput: string): string {
	return maxMatch(readelfOutput, /GLIBC_(\d+\.\d+(?:\.\d+)?)/g);
}

export function maxRequiredGlibcxx(readelfOutput: string): string {
	return maxMatch(readelfOutput, /GLIBCXX_(\d+\.\d+(?:\.\d+)?)/g);
}

export function isAbiAllowed(system: AbiVersion, required: AbiVersion): boolean {
	return compareVersion(system.glibc, required.glibc) >= 0
		&& compareVersion(system.glibcxx, required.glibcxx) >= 0;
}

function maxMatch(output: string, regexp: RegExp): string {
	const versions = [...output.matchAll(regexp)].map(match => match[1]);
	if (versions.length === 0) {
		return '0';
	}
	return versions.sort(compareVersion).at(-1)!;
}

function compareVersion(a: string, b: string): number {
	const left = a.split('.').map(Number);
	const right = b.split('.').map(Number);
	const length = Math.max(left.length, right.length);
	for (let index = 0; index < length; index++) {
		const diff = (left[index] ?? 0) - (right[index] ?? 0);
		if (diff !== 0) {
			return diff;
		}
	}
	return 0;
}
