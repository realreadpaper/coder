/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface ServerEndpoint {
	readonly host: string;
	readonly port: number;
}

export interface RemoteAiErrorMarker {
	readonly code: string;
	readonly detail: string;
}

export function parseServerListening(output: string): ServerEndpoint | undefined {
	const match = output.match(/listeningOn====([^:]+):(\d+)====/);
	if (match) {
		return { host: match[1], port: Number(match[2]) };
	}

	const codeOssMatch = output.match(/Extension host agent listening on (\d+)/);
	if (codeOssMatch) {
		return { host: '127.0.0.1', port: Number(codeOssMatch[1]) };
	}

	return undefined;
}

export function parseRemoteAiError(output: string): RemoteAiErrorMarker | undefined {
	const match = output.match(/remoteai-error\s+([^=\s]+)=(.*)/);
	if (!match) {
		return undefined;
	}
	return { code: match[1], detail: match[2] };
}
