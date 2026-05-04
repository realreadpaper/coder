/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const codexSecondarySidebarSupportContext = 'chatgpt.doesNotSupportSecondarySidebar';
export const codexSidebarPlacementDelays: number[] = [0, 250, 1000, 3000];

export function shouldForceCodexSecondarySidebar(extensionId: string | undefined): boolean {
	return extensionId === undefined || extensionId.toLowerCase() === 'openai.chatgpt';
}
