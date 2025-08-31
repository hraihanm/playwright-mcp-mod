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
import { defineTool } from '../tool.js';
import { outputFile } from '../../config.js';

import * as fs from 'fs/promises';

const downloadPageSchema = z.object({
  url: z.string().optional().describe('The URL to download. If omitted, uses the currently active tab.'),
  filename: z.string().optional().describe('File name to save the HTML to. Defaults to `page-{timestamp}.html`. If no extension is provided, `.html` will be added.'),
});

const downloadPage = defineTool({
  capability: 'core',
  schema: {
    name: 'browser_download_page',
    title: 'Download page HTML',
    description: 'Download the current page HTML (or from a provided URL) and save it to a local file.',
    inputSchema: downloadPageSchema,
    type: 'readOnly',
  },
  handle: async (context, params) => {
    const tab = await context.ensureTab();

    if (params.url)
      await tab.navigate(params.url);

    const defaultName = `page-${new Date().toISOString()}.html`;
    const requestedName = params.filename ?? defaultName;
    const nameWithExtension = /\.(?:html?|HTML?)$/.test(requestedName) ? requestedName : `${requestedName}.html`;
    const fileName = await outputFile(context.config, nameWithExtension);

    const code = [
      params.url ? `// Navigate to ${params.url}` : `// Use the active tab`,
      params.url ? `await page.goto('${params.url}');` : `// Already on the desired page`,
      `// Save page HTML as ${fileName}`,
      `const html = await page.content();`,
      `// <internal code to save html to ${fileName}>`,
    ];

    const action = async () => {
      const html = await tab.page.content();
      await fs.writeFile(fileName, html);
    };

    return {
      code,
      action,
      captureSnapshot: !!params.url,
      waitForNetwork: false,
    };
  },
});

export default [
  downloadPage,
];


