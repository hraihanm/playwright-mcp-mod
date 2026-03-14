import { z } from 'zod';
import { defineTool } from '../tool.js';
import { shouldFilterRequest, getResourceType } from './network_utils.js';
import fs from 'fs';
import path from 'path';

const SKIP_HEADERS = new Set([
  'content-length', 'host', ':method', ':path', ':scheme', ':authority',
  'transfer-encoding', 'connection',
]);

const networkReplaySchema = z.object({
  url_pattern: z.string().describe('URL substring or regex to match in captured network log'),
  output_path: z.string().describe('Absolute path to save the response body'),
  method: z.string().optional().describe('Filter by HTTP method (GET, POST, etc). Default: any'),
  use_captured_headers: z.boolean().optional().default(true).describe('Re-use request headers from the captured request. Default: true'),
  is_regex: z.boolean().optional().default(false).describe('Treat url_pattern as regex. Default: false (substring match)'),
});

const networkReplay = defineTool({
  capability: 'core',
  schema: {
    name: 'browser_network_replay',
    title: 'Replay captured network request',
    description: 'Find a previously captured network request by URL pattern, replay it via fetch (inheriting browser cookies/session), and save the response to a file. Useful for re-fetching API responses with the same headers/body that the browser originally used.',
    inputSchema: networkReplaySchema,
    type: 'readOnly',
  },
  handle: async (context, params) => {
    const tab = context.currentTabOrDie();
    const requests = tab.requests();

    // Build matcher
    let matcher: (url: string) => boolean;
    if (params.is_regex) {
      try {
        const regex = new RegExp(params.url_pattern, 'i');
        matcher = (url: string) => regex.test(url);
      } catch (e: unknown) {
        return {
          code: [`// browser_network_replay`],
          captureSnapshot: false,
          waitForNetwork: false,
          resultOverride: {
            content: [{ type: 'text', text: `Invalid regex pattern: ${(e as Error).message}` }],
          },
        };
      }
    } else {
      const lower = params.url_pattern.toLowerCase();
      matcher = (url: string) => url.toLowerCase().includes(lower);
    }

    const methodFilter = params.method ? params.method.toUpperCase() : null;

    let matched = null;
    for (const [request] of requests.entries()) {
      const url = request.url();
      const resourceType = getResourceType(request);
      if (shouldFilterRequest(url, resourceType)) continue;
      if (!matcher(url)) continue;
      if (methodFilter && request.method().toUpperCase() !== methodFilter) continue;
      matched = request;
      break;
    }

    if (!matched) {
      return {
        code: [`// browser_network_replay`],
        captureSnapshot: false,
        waitForNetwork: false,
        resultOverride: {
          content: [{ type: 'text', text: `No captured request matching "${params.url_pattern}"${methodFilter ? ` with method ${methodFilter}` : ''}. Use browser_network_search to find the right pattern.` }],
        },
      };
    }

    const replayUrl = matched.url();
    const replayMethod = matched.method().toUpperCase();
    const rawHeaders = params.use_captured_headers ? matched.headers() : {};
    const replayHeaders: Record<string, string> = {};
    if (params.use_captured_headers) {
      for (const [k, v] of Object.entries(rawHeaders)) {
        if (!SKIP_HEADERS.has(k.toLowerCase()))
          replayHeaders[k] = v;
      }
    }
    const replayBody = matched.postData() || undefined;

    try {
      const result = await tab.page.evaluate(
        async ({ url, method, headers, body }: { url: string; method: string; headers: Record<string, string>; body?: string }) => {
          const opts: RequestInit = { method, headers };
          if (body && method !== 'GET') opts.body = body;
          const resp = await fetch(url, opts);
          const text = await resp.text();
          return {
            status: resp.status,
            statusText: resp.statusText,
            contentType: resp.headers.get('content-type') || '',
            body: text.length > 5 * 1024 * 1024 ? null : text,
            bodyLength: text.length,
          };
        },
        { url: replayUrl, method: replayMethod, headers: replayHeaders, body: replayBody }
      );

      if (result.body === null) {
        return {
          code: [`// browser_network_replay`],
          captureSnapshot: false,
          waitForNetwork: false,
          resultOverride: {
            content: [{ type: 'text', text: `Response too large (${result.bodyLength} bytes). Cannot save.` }],
          },
        };
      }

      const outputDir = path.dirname(params.output_path);
      if (!fs.existsSync(outputDir))
        fs.mkdirSync(outputDir, { recursive: true });

      fs.writeFileSync(params.output_path, result.body, 'utf8');

      const lines = [
        '## Network Request Replayed',
        `Matched URL: ${replayUrl}`,
        `Method: ${replayMethod} | Status: ${result.status} ${result.statusText}`,
        `Content-Type: ${result.contentType}`,
        `Response size: ${result.bodyLength} chars`,
        `Saved to: ${params.output_path}`,
        `Headers used: ${params.use_captured_headers ? 'captured request headers (filtered)' : 'none'}`,
      ];

      return {
        code: [`// browser_network_replay("${params.url_pattern}")`],
        captureSnapshot: false,
        waitForNetwork: false,
        resultOverride: {
          content: [{ type: 'text', text: lines.join('\n') }],
        },
      };
    } catch (e: unknown) {
      return {
        code: [`// browser_network_replay`],
        captureSnapshot: false,
        waitForNetwork: false,
        resultOverride: {
          content: [{ type: 'text', text: `Replay failed: ${(e as Error).message}` }],
        },
      };
    }
  },
});

export default [networkReplay];
