/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { z } from 'zod';

import { defineTool } from './tool.js';
import * as javascript from '../javascript.js';
import { generateLocator } from './utils.js';

const snapshot = defineTool({
  capability: 'core',
  schema: {
    name: 'browser_snapshot',
    title: 'Page snapshot',
    description: 'Capture accessibility snapshot of the current page, this is better than screenshot',
    inputSchema: z.object({}),
    type: 'readOnly',
  },

  handle: async context => {
    await context.ensureTab();

    const tab = context.currentTabOrDie();
    await tab.captureSnapshot();

    const code = [`// <internal code to capture accessibility snapshot>`];

    const sections: string[] = [];
    if (context.tabs().length > 1)
      sections.push('', await context.listTabsMarkdown());

    if (context.tabs().length > 1)
      sections.push('', '### Current tab');
    else
      sections.push('', '### Page state');

    sections.push(
      `- Page URL: ${tab.page.url()}`,
      `- Page Title: ${await tab.title()}`
    );
    sections.push(tab.snapshotOrDie().text());

    return {
      code,
      captureSnapshot: false,
      waitForNetwork: false,
      resultOverride: {
        content: [
          {
            type: 'text' as const,
            text: `### Ran Playwright code\n\n\`\`\`js\n${code.join('\n')}\n\`\`\``,
          },
          {
            type: 'text' as const,
            text: sections.join('\n'),
          }
        ]
      }
    };
  },
});

export const elementSchema = z.object({
  element: z.string().describe('Human-readable element description used to obtain permission to interact with the element'),
  ref: z.string().describe('Exact target element reference from the page snapshot'),
});

const clickSchema = elementSchema.extend({
  doubleClick: z.boolean().optional().describe('Whether to perform a double click instead of a single click'),
  button: z.enum(['left', 'right', 'middle']).optional().describe('Button to click, defaults to left'),
});

const click = defineTool({
  capability: 'core',
  schema: {
    name: 'browser_click',
    title: 'Click',
    description: 'Perform click on a web page',
    inputSchema: clickSchema,
    type: 'destructive',
  },

  handle: async (context, params) => {
    const tab = context.currentTabOrDie();
    const locator = tab.snapshotOrDie().refLocator(params);
    const button = params.button;
    const buttonAttr = button ? `{ button: '${button}' }` : '';

    const code: string[] = [];
    if (params.doubleClick) {
      code.push(`// Double click ${params.element}`);
      code.push(`await page.${await generateLocator(locator)}.dblclick(${buttonAttr});`);
    } else {
      code.push(`// Click ${params.element}`);
      code.push(`await page.${await generateLocator(locator)}.click(${buttonAttr});`);
    }

    return {
      code,
      action: () => params.doubleClick ? locator.dblclick({ button }) : locator.click({ button }),
      captureSnapshot: true,
      waitForNetwork: true,
      resultOverride: {
        content: [{ type: 'text', text: `${params.doubleClick ? 'Double clicked' : 'Clicked'} ${params.element}` }]
      },
    };
  },
});

const drag = defineTool({
  capability: 'core',
  schema: {
    name: 'browser_drag',
    title: 'Drag mouse',
    description: 'Perform drag and drop between two elements',
    inputSchema: z.object({
      startElement: z.string().describe('Human-readable source element description used to obtain the permission to interact with the element'),
      startRef: z.string().describe('Exact source element reference from the page snapshot'),
      endElement: z.string().describe('Human-readable target element description used to obtain the permission to interact with the element'),
      endRef: z.string().describe('Exact target element reference from the page snapshot'),
    }),
    type: 'destructive',
  },

  handle: async (context, params) => {
    const snapshot = context.currentTabOrDie().snapshotOrDie();
    const startLocator = snapshot.refLocator({ ref: params.startRef, element: params.startElement });
    const endLocator = snapshot.refLocator({ ref: params.endRef, element: params.endElement });

    const code = [
      `// Drag ${params.startElement} to ${params.endElement}`,
      `await page.${await generateLocator(startLocator)}.dragTo(page.${await generateLocator(endLocator)});`
    ];

    return {
      code,
      action: () => startLocator.dragTo(endLocator),
      captureSnapshot: true,
      waitForNetwork: true,
      resultOverride: {
        content: [{ type: 'text', text: `Dragged ${params.startElement} to ${params.endElement}` }]
      },
    };
  },
});

const hover = defineTool({
  capability: 'core',
  schema: {
    name: 'browser_hover',
    title: 'Hover mouse',
    description: 'Hover over element on page',
    inputSchema: elementSchema,
    type: 'readOnly',
  },

  handle: async (context, params) => {
    const snapshot = context.currentTabOrDie().snapshotOrDie();
    const locator = snapshot.refLocator(params);

    const code = [
      `// Hover over ${params.element}`,
      `await page.${await generateLocator(locator)}.hover();`
    ];

    return {
      code,
      action: () => locator.hover(),
      captureSnapshot: true,
      waitForNetwork: true,
      resultOverride: {
        content: [{ type: 'text', text: `Hovered over ${params.element}` }]
      },
    };
  },
});

const selectOptionSchema = elementSchema.extend({
  values: z.array(z.string()).describe('Array of values to select in the dropdown. This can be a single value or multiple values.'),
});

const selectOption = defineTool({
  capability: 'core',
  schema: {
    name: 'browser_select_option',
    title: 'Select option',
    description: 'Select an option in a dropdown',
    inputSchema: selectOptionSchema,
    type: 'destructive',
  },

  handle: async (context, params) => {
    const snapshot = context.currentTabOrDie().snapshotOrDie();
    const locator = snapshot.refLocator(params);

    const code = [
      `// Select options [${params.values.join(', ')}] in ${params.element}`,
      `await page.${await generateLocator(locator)}.selectOption(${javascript.formatObject(params.values)});`
    ];

    return {
      code,
      action: () => locator.selectOption(params.values).then(() => {}),
      captureSnapshot: true,
      waitForNetwork: true,
      resultOverride: {
        content: [{ type: 'text', text: `Selected options [${params.values.join(', ')}] in ${params.element}` }]
      },
    };
  },
});

export default [
  snapshot,
  click,
  drag,
  hover,
  selectOption,
];
