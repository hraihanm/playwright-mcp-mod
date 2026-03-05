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
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

/** Find local_runner.rb relative to this compiled file */
function findLocalRunner(): string | null {
  const candidates = [
    path.join(__dirname, '..', '..', '..', 'scraping', 'local_runner.rb'),
    path.join(__dirname, '..', '..', 'scraping', 'local_runner.rb'),
    path.join(process.cwd(), 'scraping', 'local_runner.rb'),
    path.join(process.cwd(), 'local_runner.rb'),
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const datahenRunSchema = z.object({
  scraper_dir: z.string().describe(
    'Absolute path to the scraper directory containing config.yaml.',
  ),
  command: z.enum(['seed', 'step', 'status', 'pages', 'outputs', 'reset']).describe(
    'seed: run seeder and populate queue. ' +
    'step: fetch+parse N pages. ' +
    'status: show queue/output stats. ' +
    'pages: list queue pages. ' +
    'outputs: show collected outputs. ' +
    'reset: clear all local state.',
  ),
  count: z.number().optional().describe(
    'Number of pages to process per step (default: 1). Only used with "step".',
  ),
  page_type: z.string().optional().describe(
    'Filter by page_type. Useful with "step" to process only one parser at a time, or with "pages" to list specific types.',
  ),
  status_filter: z.string().optional().describe(
    'Filter pages by status (to_fetch, parsed, parsing_failed, etc.). Only used with "pages".',
  ),
  collection: z.string().optional().describe(
    'Filter outputs by collection name. Only used with "outputs".',
  ),
  limit: z.number().optional().describe(
    'Max items to display for "pages" and "outputs" commands (default: 20).',
  ),
  delay: z.number().optional().describe(
    'Seconds to wait between HTTP fetches (default: 0.5). Set to 0 for no delay.',
  ),
  quiet: z.boolean().optional().default(false).describe(
    'Suppress verbose runner output (default: false).',
  ),
});

const datahenRun = defineTool({
  capability: 'core',
  schema: {
    name: 'datahen_run',
    title: 'Run local DataHen pipeline',
    description:
      'Run the local DataHen V3 pipeline runner (local_runner.rb) to mimic the real DataHen scraper lifecycle locally. ' +
      'Supports seeding, step-by-step page processing, queue inspection, and output viewing. ' +
      'State is persisted in <scraper_dir>/.local-state/ (queue, outputs, HTTP cache). ' +
      'Workflow: seed → step (repeat) → outputs. ' +
      'Use page_type filter with step to process one parser at a time during development.',
    inputSchema: datahenRunSchema,
    type: 'readOnly',
  },

  handle: async (_context, params) => {
    const runnerPath = findLocalRunner();

    if (!runnerPath) {
      return {
        code: ['// datahen_run — local_runner.rb not found'],
        captureSnapshot: false,
        waitForNetwork: false,
        resultOverride: {
          content: [{
            type: 'text' as const,
            text: [
              '❌ **local_runner.rb not found**',
              '',
              'Expected location: `scraping/local_runner.rb` relative to the playwright-mcp-mod package root.',
              `Searched near: \`${__dirname}\``,
            ].join('\n'),
          }],
        },
      };
    }

    if (!fs.existsSync(params.scraper_dir)) {
      return {
        code: ['// datahen_run — scraper directory not found'],
        captureSnapshot: false,
        waitForNetwork: false,
        resultOverride: {
          content: [{
            type: 'text' as const,
            text: `❌ **Scraper directory not found:** \`${params.scraper_dir}\``,
          }],
        },
      };
    }

    const configPath = path.join(params.scraper_dir, 'config.yaml');
    if (!fs.existsSync(configPath)) {
      return {
        code: ['// datahen_run — config.yaml not found'],
        captureSnapshot: false,
        waitForNetwork: false,
        resultOverride: {
          content: [{
            type: 'text' as const,
            text: `❌ **config.yaml not found in:** \`${params.scraper_dir}\``,
          }],
        },
      };
    }

    // Build argument list
    const args: string[] = [
      runnerPath,
      '-s', params.scraper_dir,
      params.command,
    ];

    if (params.command === 'step') {
      if (params.count != null)     args.push('--count',     String(params.count));
      if (params.page_type)         args.push('--page-type', params.page_type);
      if (params.delay != null)     args.push('--delay',     String(params.delay));
    }

    if (params.command === 'pages') {
      if (params.page_type)         args.push('--page-type', params.page_type);
      if (params.status_filter)     args.push('--status',    params.status_filter);
      if (params.limit != null)     args.push('--limit',     String(params.limit));
    }

    if (params.command === 'outputs') {
      if (params.collection)        args.push('--collection', params.collection);
      if (params.limit != null)     args.push('--limit',      String(params.limit));
    }

    if (params.quiet) args.push('--quiet');

    const displayCmd = `ruby ${args.join(' ')}`;

    // Execute
    const result = await new Promise<{ stdout: string; stderr: string; exitCode: number }>(
      (resolve, reject) => {
        const child = spawn('ruby', args, {
          cwd: process.cwd(),
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';

        child.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
        child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });

        child.on('close',  (code: number | null) => resolve({ stdout, stderr, exitCode: code ?? -1 }));
        child.on('error',  (err: Error)           => reject(err));

        // 5-minute timeout (large sites may queue many pages)
        setTimeout(() => { child.kill(); reject(new Error('Timeout after 5 minutes')); }, 300_000);
      },
    );

    const normalize = (s: string) => s.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
    const out  = normalize(result.stdout);
    const err  = normalize(result.stderr);
    const ok   = result.exitCode === 0;
    const icon = ok ? '✅' : '❌';

    const lines: string[] = [
      `${icon} **datahen_run ${params.command}** (exit ${result.exitCode})`,
      '',
      `**Command:** \`${displayCmd}\``,
    ];

    if (out) {
      lines.push('', '**Output:**', '```', out, '```');
    }

    if (err) {
      lines.push('', ok ? '**Warnings:**' : '**Error:**', '```', err, '```');
    }

    if (!out && !err) {
      lines.push('', '_(no output)_');
    }

    return {
      code: [`// datahen_run ${params.command}: ${displayCmd}`],
      captureSnapshot: false,
      waitForNetwork: false,
      resultOverride: {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
      },
    };
  },
});

export default [datahenRun];
