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

const close = defineTool({
  capability: 'core',

  schema: {
    name: 'browser_close',
    title: 'Close browser',
    description: 'Close the page',
    inputSchema: z.object({}),
    type: 'readOnly',
  },

  handle: async context => {
    await context.close();
    return {
      code: [`await page.close()`],
      captureSnapshot: false,
      waitForNetwork: false,
    };
  },
});

const resize = defineTool({
  capability: 'core',
  schema: {
    name: 'browser_resize',
    title: 'Resize browser window',
    description: 'Resize the browser window',
    inputSchema: z.object({
      width: z.number().describe('Width of the browser window'),
      height: z.number().describe('Height of the browser window'),
    }),
    type: 'readOnly',
  },

  handle: async (context, params) => {
    const tab = context.currentTabOrDie();

    const code = [
      `// Resize browser window to ${params.width}x${params.height}`,
      `await page.setViewportSize({ width: ${params.width}, height: ${params.height} });`
    ];

    const action = async () => {
      await tab.page.setViewportSize({ width: params.width, height: params.height });
    };

    return {
      code,
      action,
      captureSnapshot: true,
      waitForNetwork: true
    };
  },
});

export default [
  close,
  resize
];
