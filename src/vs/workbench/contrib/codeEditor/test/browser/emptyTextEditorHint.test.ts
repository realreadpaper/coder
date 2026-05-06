/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Event } from '../../../../../base/common/event.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { withTestCodeEditor } from '../../../../../editor/test/browser/testCodeEditor.js';
import { ServiceCollection } from '../../../../../platform/instantiation/common/serviceCollection.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IChatAgentService } from '../../../chat/common/chatAgents.js';
import { EmptyTextEditorHintContribution } from '../../browser/emptyTextEditorHint/emptyTextEditorHint.js';
import { EmptyCellEditorHintContribution } from '../../../notebook/browser/contrib/editorHint/emptyCellEditorHint.js';

suite('EmptyTextEditorHintContribution', () => {

	function createServices(): ServiceCollection {
		return new ServiceCollection(
			[
				IChatAgentService,
				{
					_serviceBrand: undefined,
					onDidChangeAgents: Event.None,
					getActivatedAgents: () => [],
					getDefaultAgent: () => undefined
				} as unknown as IChatAgentService
			],
			[
				IEditorService,
				{
					_serviceBrand: undefined,
					activeEditorPane: undefined
				} as unknown as IEditorService
			]
		);
	}

	test('instantiates when inline chat session service is not registered', () => {
		withTestCodeEditor('', { serviceCollection: createServices() }, editor => {
			assert.doesNotThrow(() => editor.registerAndInstantiateContribution(EmptyTextEditorHintContribution.ID, EmptyTextEditorHintContribution));
		});
	});

	test('instantiates empty notebook cell hint when inline chat session service is not registered', () => {
		withTestCodeEditor('', { serviceCollection: createServices() }, editor => {
			assert.doesNotThrow(() => editor.registerAndInstantiateContribution(EmptyCellEditorHintContribution.CONTRIB_ID, EmptyCellEditorHintContribution));
		});
	});

	ensureNoDisposablesAreLeakedInTestSuite();
});
