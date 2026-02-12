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
import fs from 'fs';
import path from 'path';

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024; // 5MB

const networkRequestSchema = z.object({
  url: z.string().describe('Full URL to request.'),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).optional().default('GET').describe('HTTP method. Defaults to GET.'),
  headers: z.record(z.string()).optional().default({}).describe('Custom request headers as key-value pairs.'),
  body: z.string().optional().describe('Request body (for POST/PUT/PATCH requests).'),
  outputPath: z.string().describe('Absolute path to save the response body to.'),
});

const networkRequest = defineTool({
  capability: 'core',
  schema: {
    name: 'browser_request',
    title: 'Make HTTP request',
    description: 'Make an arbitrary HTTP request from the browser context (inheriting cookies/session) and save the response body to a file. Uses page.evaluate(fetch()) to run inside the browser tab, automatically inheriting cookies, auth tokens, and CORS context. Useful for replaying API calls discovered via browser_network_search.',
    inputSchema: networkRequestSchema,
    type: 'readOnly',
  },

  handle: async (context, params) => {
    const tab = context.currentTabOrDie();

    try {
      const result = await tab.page.evaluate(async ({ url, method, headers, body }: { url: string; method: string; headers: Record<string, string>; body?: string }) => {
        const resp = await fetch(url, {
          method,
          headers,
          body: body || undefined,
        });
        const text = await resp.text();
        return {
          status: resp.status,
          statusText: resp.statusText,
          contentType: resp.headers.get('content-type') || '',
          bodyLength: text.length,
          body: text.length > 5 * 1024 * 1024 ? null : text,
          truncated: text.length > 5 * 1024 * 1024,
        };
      }, {
        url: params.url,
        method: params.method,
        headers: params.headers,
        body: params.body,
      });

      if (result.body === null) {
        return {
          code: [`// <internal code to make HTTP request>`],
          captureSnapshot: false,
          waitForNetwork: false,
          resultOverride: {
            content: [{ type: 'text', text: `Response too large (${result.bodyLength} chars, max ${MAX_RESPONSE_SIZE} chars). Cannot save to file.` }],
          },
        };
      }

      // Ensure output directory exists
      const outputDir = path.dirname(params.outputPath);
      if (!fs.existsSync(outputDir))
        fs.mkdirSync(outputDir, { recursive: true });

      // Write response body to file
      fs.writeFileSync(params.outputPath, result.body, 'utf8');

      const lines: string[] = [];
      lines.push('## HTTP Request Completed');
      lines.push(`[${params.method}] ${params.url} => [${result.status}] ${result.statusText}`);
      lines.push(`Content-Type: ${result.contentType}`);
      lines.push(`Response size: ${result.bodyLength} chars`);
      lines.push(`Saved to: ${params.outputPath}`);

      return {
        code: [`// <internal code to make HTTP request>`],
        captureSnapshot: false,
        waitForNetwork: false,
        resultOverride: {
          content: [{ type: 'text', text: lines.join('\n') }],
        },
      };
    } catch (e: unknown) {
      const error = e as Error;
      return {
        code: [`// <internal code to make HTTP request>`],
        captureSnapshot: false,
        waitForNetwork: false,
        resultOverride: {
          content: [{ type: 'text', text: `HTTP request failed: ${error.message}\n\nMake sure a page is loaded in the browser first (browser_navigate) so the request can inherit the browser's cookies and session context.` }],
        },
      };
    }
  },
});

export default [
  networkRequest,
];
