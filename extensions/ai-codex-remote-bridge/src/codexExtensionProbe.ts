/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface ExtensionPackageJson {
	readonly publisher?: string;
	readonly name?: string;
	readonly displayName?: string;
	readonly main?: string;
	readonly enabledApiProposals?: string[];
}

export interface CodexPackageClassification {
	readonly isCodex: boolean;
	readonly requiredProposals: string[];
}

export function classifyCodexPackage(pkg: ExtensionPackageJson): CodexPackageClassification {
	const isCodex = pkg.publisher === 'openai' && pkg.name === 'chatgpt' && typeof pkg.main === 'string';
	return {
		isCodex,
		requiredProposals: isCodex ? [...(pkg.enabledApiProposals ?? [])] : []
	};
}
