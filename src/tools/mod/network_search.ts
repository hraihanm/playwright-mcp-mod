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
import type * as playwright from 'playwright';
import { shouldFilterRequest, getResourceType } from './network_utils.js';

const BINARY_CONTENT_TYPES = /^(image|audio|video)\//i;
const BINARY_EXTENSIONS = /\.(pdf|zip|gz|tar|rar|7z|exe|dll|so|dylib|woff2?|ttf|otf|eot)$/i;
const MAX_RESPONSE_SIZE = 5 * 1024 * 1024; // 5MB

type SearchField = 'url' | 'requestHeaders' | 'requestBody' | 'responseHeaders' | 'responseBody';

const searchFieldEnum = z.enum(['url', 'requestHeaders', 'requestBody', 'responseHeaders', 'responseBody']);

const networkSearchSchema = z.object({
  query: z.string().describe('Search string or regex pattern to find in network requests.'),
  isRegex: z.boolean().optional().default(false).describe('Treat query as a regular expression. Defaults to false (literal string match).'),
  searchIn: z.array(searchFieldEnum).optional().default(['url', 'requestBody', 'responseBody']).describe('Which fields to search. Defaults to url, requestBody, responseBody.'),
  contextChars: z.number().optional().default(120).describe('Characters of context to show before and after each match. Defaults to 120.'),
  maxResults: z.number().optional().default(20).describe('Maximum number of matching requests to return. Defaults to 20.'),
  maxMatchesPerField: z.number().optional().default(3).describe('Maximum excerpts to show per field per request. Defaults to 3.'),
  includeFilteredDomains: z.boolean().optional().default(false).describe('Include analytics/tracking domains that are normally filtered out. Defaults to false.'),
});

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractSnippets(text: string, regex: RegExp, contextChars: number, maxMatches: number): { snippets: string[]; totalMatches: number } {
  const snippets: string[] = [];
  let totalMatches = 0;
  let match: RegExpExecArray | null;

  // Clone regex with global flag to iterate all matches
  const globalRegex = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'g');

  while ((match = globalRegex.exec(text)) !== null) {
    totalMatches++;
    if (snippets.length < maxMatches) {
      const start = Math.max(0, match.index - contextChars);
      const end = Math.min(text.length, match.index + match[0].length + contextChars);
      const before = text.substring(start, match.index);
      const after = text.substring(match.index + match[0].length, end);
      const prefix = start > 0 ? '...' : '';
      const suffix = end < text.length ? '...' : '';
      snippets.push(`${prefix}${before}>>>${match[0]}<<<${after}${suffix}`);
    }
    // Prevent infinite loops on zero-length matches
    if (match[0].length === 0)
      globalRegex.lastIndex++;
  }

  return { snippets, totalMatches };
}

function formatHeaders(headers: Record<string, string>): string {
  return Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join('\n');
}

async function safeGetResponseText(response: playwright.Response): Promise<string | null> {
  // Check content-type for binary
  const contentType = response.headers()['content-type'] || '';
  if (BINARY_CONTENT_TYPES.test(contentType) || BINARY_EXTENSIONS.test(response.url()))
    return null;

  // Check content-length
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

interface FieldMatch {
  field: SearchField;
  totalLength: number;
  totalMatches: number;
  snippets: string[];
}

interface RequestMatch {
  method: string;
  url: string;
  status: number | null;
  statusText: string;
  resourceType: string;
  contentType: string;
  fields: FieldMatch[];
}

const networkSearch = defineTool({
  capability: 'core',
  schema: {
    name: 'browser_network_search',
    title: 'Search network requests',
    description: 'Search captured network requests like Chrome DevTools Network tab search. Searches across URLs, headers, and response bodies to find API calls containing specific data (e.g., product names, prices, JSON fields). Returns context snippets around matches with >>>highlight<<< markers. Useful for discovering API endpoints that return structured data for scraping.',
    inputSchema: networkSearchSchema,
    type: 'readOnly',
  },

  handle: async (context, params) => {
    const tab = context.currentTabOrDie();
    const requests = tab.requests();

    // Build regex
    let regex: RegExp;
    try {
      const pattern = params.isRegex ? params.query : escapeRegex(params.query);
      regex = new RegExp(pattern, 'gi');
    } catch (e: unknown) {
      return {
        code: [`// <internal code to search network requests>`],
        captureSnapshot: false,
        waitForNetwork: false,
        resultOverride: {
          content: [{ type: 'text', text: `Invalid regex pattern: ${(e as Error).message}` }],
        },
      };
    }

    const searchFields = new Set<SearchField>(params.searchIn);
    const results: RequestMatch[] = [];
    let totalRequests = 0;

    for (const [request, response] of requests.entries()) {
      const url = request.url();
      const resourceType = getResourceType(request);

      // Filter out analytics/tracking unless requested
      if (!params.includeFilteredDomains && shouldFilterRequest(url, resourceType))
        continue;

      totalRequests++;

      const fieldMatches: FieldMatch[] = [];

      // Search URL
      if (searchFields.has('url')) {
        const { snippets, totalMatches } = extractSnippets(url, regex, params.contextChars, params.maxMatchesPerField);
        if (totalMatches > 0)
          fieldMatches.push({ field: 'url', totalLength: url.length, totalMatches, snippets });
      }

      // Search request headers
      if (searchFields.has('requestHeaders')) {
        try {
          const headersText = formatHeaders(request.headers());
          const { snippets, totalMatches } = extractSnippets(headersText, regex, params.contextChars, params.maxMatchesPerField);
          if (totalMatches > 0)
            fieldMatches.push({ field: 'requestHeaders', totalLength: headersText.length, totalMatches, snippets });
        } catch {
          // headers may not be available
        }
      }

      // Search request body
      if (searchFields.has('requestBody')) {
        const postData = request.postData();
        if (postData) {
          const { snippets, totalMatches } = extractSnippets(postData, regex, params.contextChars, params.maxMatchesPerField);
          if (totalMatches > 0)
            fieldMatches.push({ field: 'requestBody', totalLength: postData.length, totalMatches, snippets });
        }
      }

      // Search response headers
      if (searchFields.has('responseHeaders') && response) {
        try {
          const headersText = formatHeaders(response.headers());
          const { snippets, totalMatches } = extractSnippets(headersText, regex, params.contextChars, params.maxMatchesPerField);
          if (totalMatches > 0)
            fieldMatches.push({ field: 'responseHeaders', totalLength: headersText.length, totalMatches, snippets });
        } catch {
          // headers may not be available
        }
      }

      // Search response body (async)
      if (searchFields.has('responseBody') && response) {
        const body = await safeGetResponseText(response);
        if (body) {
          const { snippets, totalMatches } = extractSnippets(body, regex, params.contextChars, params.maxMatchesPerField);
          if (totalMatches > 0)
            fieldMatches.push({ field: 'responseBody', totalLength: body.length, totalMatches, snippets });
        }
      }

      if (fieldMatches.length > 0) {
        results.push({
          method: request.method().toUpperCase(),
          url,
          status: response ? response.status() : null,
          statusText: response ? response.statusText() : '',
          resourceType: resourceType || 'unknown',
          contentType: response ? (response.headers()['content-type'] || '') : '',
          fields: fieldMatches,
        });

        if (results.length >= params.maxResults)
          break;
      }
    }

    // Format output
    const searchInLabel = params.searchIn.join(', ');
    const lines: string[] = [];
    lines.push(`## Network Search Results`);
    lines.push(`Query: "${params.query}"${params.isRegex ? ' (regex)' : ''} | Searched in: ${searchInLabel}`);
    lines.push(`Found: ${results.length} matching requests (out of ${totalRequests} total)`);

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      lines.push('');
      lines.push('---');
      let header = `### [${i + 1}] [${r.method}] ${r.url}`;
      if (r.status !== null)
        header += ` => [${r.status}] ${r.statusText}`;
      lines.push(header);
      lines.push(`Resource type: ${r.resourceType} | Content-Type: ${r.contentType}`);

      for (const fm of r.fields) {
        lines.push('');
        lines.push(`**${fm.field}** (${fm.totalLength} chars, ${fm.totalMatches} matches, showing ${fm.snippets.length}):`);
        for (const snippet of fm.snippets)
          lines.push(`  ${snippet}`);
      }
    }

    const output = lines.join('\n');

    return {
      code: [`// <internal code to search network requests>`],
      captureSnapshot: false,
      waitForNetwork: false,
      resultOverride: {
        content: [{ type: 'text', text: output || 'No matching network requests found.' }],
      },
    };
  },
});

export default [
  networkSearch,
];
