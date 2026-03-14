import { z } from 'zod';
import { defineTool } from '../tool.js';
import fs from 'fs';
import path from 'path';

// Parse fields from config.yaml exporters section.
// Supports two formats:
//   fields: [field_name, ...]               (plain string list)
//   fields: [{ header: "x", path: "y" }]   (object list, use header key)
function parseConfigFields(yamlContent: string): string[] | null {
  // Find the exporters block — locate first "fields:" inside the exporters section
  const exportersIdx = yamlContent.indexOf('exporters:');
  if (exportersIdx === -1) return null;

  const exportersBlock = yamlContent.slice(exportersIdx);

  // Find "fields:" section within exporters
  const fieldsIdx = exportersBlock.indexOf('fields:');
  if (fieldsIdx === -1) return null;

  const afterFields = exportersBlock.slice(fieldsIdx + 'fields:'.length);

  const fields: string[] = [];

  // Match both:
  //   - plain_field_name
  //   - header: "field_name"
  //   - header: field_name
  const lines = afterFields.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    // Stop when we hit a new top-level key at the same or lower indent
    if (trimmed && !trimmed.startsWith('-') && !trimmed.startsWith('#') && /^\w/.test(trimmed) && !trimmed.startsWith('header') && !trimmed.startsWith('path') && !trimmed.startsWith('disable')) {
      break;
    }

    // Match "- header: "fieldname"" or "- header: fieldname"
    const headerMatch = trimmed.match(/^-?\s*header:\s*["']?([^"'\s]+)["']?/);
    if (headerMatch) {
      fields.push(headerMatch[1]);
      continue;
    }

    // Match plain "- field_name" (no colon in value)
    const plainMatch = trimmed.match(/^-\s+([a-zA-Z_][a-zA-Z0-9_]*)$/);
    if (plainMatch) {
      fields.push(plainMatch[1]);
    }
  }

  return fields.length > 0 ? fields : null;
}

const scraperValidatorSchema = z.object({
  scraper_dir: z.string().describe('Absolute path to scraper directory containing config.yaml'),
  outputs_json: z.string().describe('JSON string of the outputs array from parser_tester result'),
});

const scraperValidator = defineTool({
  capability: 'core',
  schema: {
    name: 'scraper_output_validator',
    title: 'Validate scraper output against config fields',
    description: 'Validate parser_tester output against the expected fields defined in config.yaml. Checks for missing fields, nil/empty required fields, and type mismatches. Paste the outputs array JSON from parser_tester result.',
    inputSchema: scraperValidatorSchema,
    type: 'readOnly',
  },
  handle: async (context, params) => {
    const configPath = path.join(params.scraper_dir, 'config.yaml');
    if (!fs.existsSync(configPath)) {
      return {
        code: [`// scraper_output_validator`],
        captureSnapshot: false,
        waitForNetwork: false,
        resultOverride: {
          content: [{ type: 'text', text: `ERROR: config.yaml not found at ${configPath}` }],
        },
      };
    }

    const yamlContent = fs.readFileSync(configPath, 'utf8');
    const expectedFields = parseConfigFields(yamlContent);

    if (!expectedFields || expectedFields.length === 0) {
      return {
        code: [`// scraper_output_validator`],
        captureSnapshot: false,
        waitForNetwork: false,
        resultOverride: {
          content: [{ type: 'text', text: `ERROR: Could not parse fields from config.yaml. Ensure exporters section has a fields list.` }],
        },
      };
    }

    let outputs: unknown[];
    try {
      outputs = JSON.parse(params.outputs_json);
      if (!Array.isArray(outputs)) outputs = [outputs];
    } catch (e: unknown) {
      return {
        code: [`// scraper_output_validator`],
        captureSnapshot: false,
        waitForNetwork: false,
        resultOverride: {
          content: [{ type: 'text', text: `ERROR: Invalid JSON in outputs_json: ${(e as Error).message}` }],
        },
      };
    }

    if (outputs.length === 0) {
      return {
        code: [`// scraper_output_validator`],
        captureSnapshot: false,
        waitForNetwork: false,
        resultOverride: {
          content: [{ type: 'text', text: `ERROR: outputs array is empty` }],
        },
      };
    }

    const output = outputs[0] as Record<string, unknown>;

    const missing: string[] = [];
    const nilOrEmpty: string[] = [];
    const typeMismatches: string[] = [];
    const present: string[] = [];

    for (const field of expectedFields) {
      if (!(field in output)) {
        missing.push(field);
        continue;
      }
      const val = output[field];
      if (val === null || val === undefined || val === '') {
        nilOrEmpty.push(field);
        present.push(field);
        continue;
      }
      present.push(field);

      // Basic type checks for known numeric fields
      const numericFields = new Set([
        'customer_price_lc', 'base_price_lc', 'discount_percentage',
        'rank_in_listing', 'page_number', 'latitude', 'longitude',
      ]);
      if (numericFields.has(field) && typeof val !== 'number' && typeof val !== 'string') {
        typeMismatches.push(`${field} (expected string/number, got ${typeof val})`);
      }
    }

    const lines: string[] = [];
    lines.push('scraper_output_validator result:');
    lines.push(`- Expected fields: ${expectedFields.length}`);
    lines.push(`- Fields present: ${present.length}`);

    if (missing.length > 0)
      lines.push(`- Missing fields: ${missing.join(', ')}`);
    else
      lines.push('- Missing fields: none');

    if (nilOrEmpty.length > 0)
      lines.push(`- Nil/empty fields: ${nilOrEmpty.join(', ')}`);
    else
      lines.push('- Nil/empty fields: none');

    if (typeMismatches.length > 0)
      lines.push(`- Type mismatches: ${typeMismatches.join(', ')}`);
    else
      lines.push('- Type mismatches: none');

    lines.push(`- Summary: ${missing.length} missing, ${nilOrEmpty.length} nil/empty field(s)`);

    if (outputs.length > 1)
      lines.push(`\nNote: ${outputs.length} outputs in array — validated first output only.`);

    return {
      code: [`// scraper_output_validator`],
      captureSnapshot: false,
      waitForNetwork: false,
      resultOverride: {
        content: [{ type: 'text', text: lines.join('\n') }],
      },
    };
  },
});

export default [scraperValidator];
