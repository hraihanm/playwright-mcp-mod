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
import { shouldFilterRequest, getResourceType } from './network_utils.js';
import fs from 'fs';
import path from 'path';
import type * as playwright from 'playwright';

const BINARY_CONTENT_TYPES = /^(image|audio|video)\//i;
const BINARY_EXTENSIONS = /\.(pdf|zip|gz|tar|rar|7z|exe|dll|so|dylib|woff2?|ttf|otf|eot)$/i;
const MAX_RESPONSE_SIZE = 5 * 1024 * 1024; // 5MB

const networkDownloadSchema = z.object({
  urlPattern: z.string().describe('Substring or regex pattern to match against captured request URLs.'),
  isRegex: z.boolean().optional().default(false).describe('Treat urlPattern as a regular expression. Defaults to false (substring match).'),
  outputPath: z.string().describe('Absolute path to save the response body to (e.g., "D:\\\\scraper\\\\cache\\\\categories-api.json").'),
  matchIndex: z.number().optional().default(0).describe('Which match to download if multiple requests match (0 = first). Defaults to 0.'),
  includeFilteredDomains: z.boolean().optional().default(false).describe('Include analytics/tracking domains that are normally filtered out. Defaults to false.'),
});

async function safeGetResponseText(response: playwright.Response): Promise<string | null> {
  const contentType = response.headers()['content-type'] || '';
  if (BINARY_CONTENT_TYPES.test(contentType) || BINARY_EXTENSIONS.test(response.url()))
    return null;

  const contentLength = response.headers()['content-length'];
  if (contentLength && parseInt(contentLength, 10) > MAX_RESPONSE_SIZE)
    return null;

  try {
    const text = await response.text();
    if (text.length > MAX_RESPONSE_SIZE)
      return null;
    return text;
  } catch {
    return null;
  }
}

const networkDownload = defineTool({
  capability: 'core',
  schema: {
    name: 'browser_network_download',
    title: 'Download network response',
    description: 'Download a captured network response body to a file. Searches captured requests for a URL matching the given pattern and saves the response body to the specified output path. Useful for saving API JSON/XML responses for offline parser testing.',
    inputSchema: networkDownloadSchema,
    type: 'readOnly',
  },

  handle: async (context, params) => {
    const tab = context.currentTabOrDie();
    const requests = tab.requests();

    // Build matcher
    let matcher: (url: string) => boolean;
    if (params.isRegex) {
      try {
        const regex = new RegExp(params.urlPattern, 'i');
        matcher = (url: string) => regex.test(url);
      } catch (e: unknown) {
        return {
          code: [`// <internal code to download network response>`],
          captureSnapshot: false,
          waitForNetwork: false,
          resultOverride: {
            content: [{ type: 'text', text: `Invalid regex pattern: ${(e as Error).message}` }],
          },
        };
      }
    } else {
      const pattern = params.urlPattern.toLowerCase();
      matcher = (url: string) => url.toLowerCase().includes(pattern);
    }

    // Collect matching requests
    interface MatchEntry {
      request: playwright.Request;
      response: playwright.Response;
    }
    const matches: MatchEntry[] = [];

    for (const [request, response] of requests.entries()) {
      const url = request.url();
      const resourceType = getResourceType(request);

      if (!params.includeFilteredDomains && shouldFilterRequest(url, resourceType))
        continue;

      if (!response)
        continue;

      if (matcher(url))
        matches.push({ request, response });
    }

    if (matches.length === 0) {
      return {
        code: [`// <internal code to download network response>`],
        captureSnapshot: false,
        waitForNetwork: false,
        resultOverride: {
          content: [{ type: 'text', text: `No captured requests matching pattern "${params.urlPattern}". Try browser_network_search first to find the right URL pattern.` }],
        },
      };
    }

    if (params.matchIndex >= matches.length) {
      return {
        code: [`// <internal code to download network response>`],
        captureSnapshot: false,
        waitForNetwork: false,
        resultOverride: {
          content: [{ type: 'text', text: `Match index ${params.matchIndex} out of range. Found ${matches.length} matching request(s) (indices 0-${matches.length - 1}).` }],
        },
      };
    }

    const selected = matches[params.matchIndex];
    const body = await safeGetResponseText(selected.response);

    if (body === null) {
      const contentType = selected.response.headers()['content-type'] || 'unknown';
      return {
        code: [`// <internal code to download network response>`],
        captureSnapshot: false,
        waitForNetwork: false,
        resultOverride: {
          content: [{ type: 'text', text: `Cannot download response body for ${selected.request.url()}\nContent-Type: ${contentType}\nThe response is binary, too large (>5MB), or the body is unavailable.` }],
        },
      };
    }

    // Ensure output directory exists
    const outputDir = path.dirname(params.outputPath);
    if (!fs.existsSync(outputDir))
      fs.mkdirSync(outputDir, { recursive: true });

    // Write body to file
    fs.writeFileSync(params.outputPath, body, 'utf8');

    const status = selected.response.status();
    const statusText = selected.response.statusText();
    const contentType = selected.response.headers()['content-type'] || 'unknown';
    const method = selected.request.method().toUpperCase();

    const lines: string[] = [];
    lines.push('## Network Response Downloaded');
    lines.push(`URL: ${selected.request.url()}`);
    lines.push(`Method: ${method} | Status: ${status} ${statusText}`);
    lines.push(`Content-Type: ${contentType}`);
    lines.push(`Content-Length: ${body.length} chars`);
    lines.push(`Saved to: ${params.outputPath}`);
    lines.push('');
    lines.push(`Matched ${matches.length} request(s) for pattern "${params.urlPattern}", downloaded match #${params.matchIndex}.`);

    return {
      code: [`// <internal code to download network response>`],
      captureSnapshot: false,
      waitForNetwork: false,
      resultOverride: {
        content: [{ type: 'text', text: lines.join('\n') }],
      },
    };
  },
});

export default [
  networkDownload,
];
