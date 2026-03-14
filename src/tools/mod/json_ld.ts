import { z } from 'zod';
import { defineTool } from '../tool.js';

function flattenFields(obj: Record<string, unknown>, prefix = '', depth = 0): string[] {
  if (depth >= 3) return [];
  const fields: string[] = [];
  for (const key of Object.keys(obj)) {
    if (key.startsWith('@')) continue;
    const val = obj[key];
    const fullKey = prefix ? `${prefix}.${key}` : key;
    fields.push(fullKey);
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      fields.push(...flattenFields(val as Record<string, unknown>, fullKey, depth + 1));
    }
  }
  return fields;
}

const jsonLdSchema = z.object({
  type: z.string().optional().describe('Filter by @type value, e.g. "Product". Default: return all JSON-LD blocks.'),
});

const extractJsonLd = defineTool({
  capability: 'core',
  schema: {
    name: 'browser_extract_json_ld',
    title: 'Extract JSON-LD structured data',
    description: 'Extract JSON-LD structured data from the current page. Finds all <script type="application/ld+json"> tags, parses them, and returns structured data with available fields listed in dot notation. Optionally filter by @type (e.g. "Product").',
    inputSchema: jsonLdSchema,
    type: 'readOnly',
  },
  handle: async (context, params) => {
    const tab = context.currentTabOrDie();
    const html = await tab.page.content();

    const scriptRegex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    const blocks: Array<{ data: unknown; index: number }> = [];

    let match: RegExpExecArray | null;
    let scriptIndex = 0;

    // Count all ld+json scripts to determine nth-of-type selector
    const allLdJsonRegex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>/gi;
    const allScriptTags = html.match(allLdJsonRegex) || [];
    const totalScripts = allScriptTags.length;

    const tempRegex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    while ((match = tempRegex.exec(html)) !== null) {
      scriptIndex++;
      const rawJson = match[1].trim();
      try {
        const parsed = JSON.parse(rawJson);
        // Handle @graph arrays
        if (parsed && parsed['@graph'] && Array.isArray(parsed['@graph'])) {
          for (const item of parsed['@graph']) {
            blocks.push({ data: item, index: scriptIndex });
          }
        } else if (Array.isArray(parsed)) {
          for (const item of parsed) {
            blocks.push({ data: item, index: scriptIndex });
          }
        } else {
          blocks.push({ data: parsed, index: scriptIndex });
        }
      } catch {
        // skip invalid JSON
      }
    }

    if (blocks.length === 0) {
      return {
        code: [`// browser_extract_json_ld`],
        captureSnapshot: false,
        waitForNetwork: false,
        resultOverride: {
          content: [{ type: 'text', text: JSON.stringify({ found: false, message: 'No JSON-LD found on page' }, null, 2) }],
        },
      };
    }

    let filtered = blocks;
    if (params.type) {
      const typeFilter = params.type.toLowerCase();
      filtered = blocks.filter(b => {
        const d = b.data as Record<string, unknown>;
        const t = d['@type'];
        if (typeof t === 'string') return t.toLowerCase() === typeFilter;
        if (Array.isArray(t)) return t.some((v: unknown) => typeof v === 'string' && v.toLowerCase() === typeFilter);
        return false;
      });
    }

    if (filtered.length === 0) {
      const types = blocks.map(b => (b.data as Record<string, unknown>)['@type']).filter(Boolean);
      return {
        code: [`// browser_extract_json_ld`],
        captureSnapshot: false,
        waitForNetwork: false,
        resultOverride: {
          content: [{ type: 'text', text: JSON.stringify({ found: false, message: `No JSON-LD with @type "${params.type}" found. Types present: ${JSON.stringify(types)}` }, null, 2) }],
        },
      };
    }

    const results = filtered.map(b => {
      const data = b.data as Record<string, unknown>;
      const fields = flattenFields(data);
      const selector = totalScripts === 1
        ? `script[type='application/ld+json']`
        : `script[type='application/ld+json']:nth-of-type(${b.index})`;

      return {
        found: true,
        type: data['@type'] || null,
        data,
        fields_available: fields,
        script_tag_selector: selector,
      };
    });

    const output = results.length === 1
      ? { ...results[0], count: 1 }
      : { found: true, count: results.length, items: results };

    return {
      code: [`// browser_extract_json_ld`],
      captureSnapshot: false,
      waitForNetwork: false,
      resultOverride: {
        content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
      },
    };
  },
});

export default [extractJsonLd];
