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
// @ts-ignore
import sanitize from 'html-sanitize';

import * as fs from 'fs/promises';

// --- SVG tag categories ---

// SVG shape/drawing elements — contain verbose `d="M..."` paths, no scraping value
const SVG_SHAPE_TAGS = [
  'path', 'circle', 'rect', 'polygon', 'polyline', 'line', 'ellipse',
];

// SVG definitions/filter elements — clip paths, masks, effects; always noise
const SVG_FILTER_TAGS = [
  'defs', 'clipPath', 'mask', 'filter',
  'feGaussianBlur', 'feOffset', 'feMerge', 'feMergeNode',
  'feComposite', 'feBlend', 'feColorMatrix', 'feComponentTransfer',
  'feFuncR', 'feFuncG', 'feFuncB', 'feFuncA', 'feConvolveMatrix',
  'feDiffuseLighting', 'feSpecularLighting', 'feDistantLight',
  'fePointLight', 'feSpotLight', 'feTile', 'feTurbulence', 'feMorphology',
  'feImage', 'feDisplacementMap', 'feFlood', 'feDropShadow',
];

// SVG container elements — useful to keep so you can see icon class/id/aria-label
const SVG_CONTAINER_TAGS = ['svg', 'g', 'symbol', 'use', 'text', 'tspan'];

// All SVG-related tags combined
const SVG_ALL_TAGS = [...SVG_CONTAINER_TAGS, ...SVG_SHAPE_TAGS, ...SVG_FILTER_TAGS];

// --- Attribute limits ---

const ATTRIBUTE_LIMITS: Record<string, number> = {
  href: 300,
  src: 300,
  srcset: 300,
  'data-src': 500,
  style: 200,
  class: 500,
  id: 500,
  data: 500,
};

// --- Sanitization ---

interface SanitizeConfig {
  removeStyleTags?: boolean;
  /** Remove ALL svg-related elements (default: true). */
  removeSvgElements?: boolean;
  /** Remove only SVG shape/path/filter elements but keep svg container tags.
   *  Only applies when removeSvgElements is false. Defaults to true. */
  removePathElements?: boolean;
  limitUrlAttributes?: boolean;
  maxAttributeValueLength?: number;
}

function createSanitizeConfig(options: SanitizeConfig = {}) {
  const allowedTags = [
    'div', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'a', 'button', 'input', 'textarea', 'select', 'option',
    'form', 'label', 'ul', 'ol', 'li', 'table', 'tr', 'td', 'th',
    'img', 'iframe', 'section', 'article', 'header', 'footer',
    'nav', 'main', 'aside', 'figure', 'figcaption', 'blockquote',
    'code', 'pre', 'em', 'strong', 'b', 'i', 'u', 'mark', 'small',
    'script', 'noscript', 'object', 'embed', 'applet',
    'base', 'basefont', 'bgsound', 'link', 'meta', 'title',
    'head', 'html', 'body',
  ];

  const tagsToRemove: string[] = [];

  if (options.removeStyleTags !== false)
    tagsToRemove.push('style');

  if (options.removeSvgElements !== false) {
    // Default: remove ALL svg-related elements
    tagsToRemove.push(...SVG_ALL_TAGS);
  } else {
    // Keep svg container tags — add them to allowedTags so they pass through
    allowedTags.push(...SVG_CONTAINER_TAGS);
    // Remove shape/filter elements (path noise) unless explicitly disabled
    if (options.removePathElements !== false)
      tagsToRemove.push(...SVG_SHAPE_TAGS, ...SVG_FILTER_TAGS);
  }

  return {
    allowedTags,
    allowedAttributes: '*',
    removeTags: [...new Set(tagsToRemove)],
    removeAttributes: [] as string[],
    compactMode: true,
  };
}

function limitAttributeValues(html: string, options: SanitizeConfig = {}): string {
  if (options.limitUrlAttributes === false)
    return html;

  const maxLength = options.maxAttributeValueLength || 200;

  return html.replace(/(\w+)=["']([^"']*)["']/g, (match, attr, value) => {
    const attrMaxLength = ATTRIBUTE_LIMITS[attr.toLowerCase() as keyof typeof ATTRIBUTE_LIMITS] || maxLength;
    if (value.length > attrMaxLength)
      return `${attr}="${value.substring(0, attrMaxLength)}..."`;
    return match;
  });
}

function sanitizeHTML(html: string, options: SanitizeConfig = {}): string {
  if (!html || html.length === 0) return '';

  try {
    const sanitizeConfig = createSanitizeConfig(options);
    let sanitized = sanitize(html, sanitizeConfig);
    sanitized = limitAttributeValues(sanitized, options);

    return sanitized
      .replace(/\s+/g, ' ')
      .replace(/>\s+</g, '><')
      .trim();
  } catch (error) {
    console.warn('HTML sanitization failed:', error);
    return html;
  }
}

// --- Snippet extraction (grep helper) ---

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractSnippets(
  text: string,
  regex: RegExp,
  contextChars: number,
  maxMatches: number,
): { snippets: string[]; totalMatches: number } {
  const snippets: string[] = [];
  let totalMatches = 0;
  let match: RegExpExecArray | null;

  const globalRegex = new RegExp(
    regex.source,
    regex.flags.includes('g') ? regex.flags : regex.flags + 'g',
  );

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
    if (match[0].length === 0)
      globalRegex.lastIndex++;
  }

  return { snippets, totalMatches };
}

// ============================================================
// Tool: browser_view_html
// ============================================================

const viewHtmlSchema = z.object({
  includeScripts: z.boolean().optional().default(false).describe('Whether to include script tags in the HTML output. Defaults to false to reduce token usage.'),
  isSanitized: z.boolean().optional().default(true).describe('Whether to sanitize the HTML content. Defaults to true to reduce token usage and remove potentially sensitive content.'),
});

const viewHtml = defineTool({
  capability: 'core',
  schema: {
    name: 'browser_view_html',
    title: 'View page HTML',
    description: 'Get the HTML content of the current page with options for including scripts and sanitization.',
    inputSchema: viewHtmlSchema,
    type: 'readOnly',
  },
  handle: async (context, params) => {
    const tab = await context.ensureTab();

    const code = [
      `// Get page HTML content`,
      `const html = await page.content();`,
      `// HTML content retrieved${params.isSanitized ? ' (sanitized)' : ''}${params.includeScripts ? ' (including scripts)' : ' (scripts excluded)'}`,
    ];

    let html = await tab.page.content();

    if (!params.includeScripts)
      html = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

    if (params.isSanitized) {
      html = sanitizeHTML(html, {
        removeStyleTags: true,
        removeSvgElements: true,
        limitUrlAttributes: true,
        maxAttributeValueLength: 200,
      });
    }

    return {
      code,
      captureSnapshot: false,
      waitForNetwork: false,
      resultOverride: {
        content: [{ type: 'text' as const, text: html }],
      },
    };
  },
});

// ============================================================
// Tool: browser_grep_html
// ============================================================

const grepHtmlSchema = z.object({
  query: z.string().describe('Search string or regex pattern to find in the page HTML.'),
  isRegex: z.boolean().optional().default(false).describe('Treat query as a regular expression. Defaults to false (literal string match).'),
  contextChars: z.number().optional().default(200).describe('Characters of HTML context to show before and after each match. Defaults to 200.'),
  maxMatches: z.number().optional().default(20).describe('Maximum number of match snippets to return. Defaults to 20.'),
  includeScripts: z.boolean().optional().default(false).describe('Include script tag content when searching. Defaults to false.'),
  sanitize: z.boolean().optional().default(true).describe('Sanitize HTML before searching: removes styles and SVG path/shape data while keeping SVG container elements (svg, g, use). Defaults to true.'),
});

const grepHtml = defineTool({
  capability: 'core',
  schema: {
    name: 'browser_grep_html',
    title: 'Grep page HTML',
    description: 'Search the current page HTML for a string or regex and return context snippets around matches with >>>highlight<<< markers. More token-efficient than browser_view_html for targeted searches. Ideal for discovering CSS selectors, class names, data attributes, and DOM structure around known text content (e.g., a product name or price). Sanitizes HTML by default: removes scripts, styles, and SVG path/shape data while keeping SVG container elements so icon classes are visible.',
    inputSchema: grepHtmlSchema,
    type: 'readOnly',
  },
  handle: async (context, params) => {
    const tab = await context.ensureTab();
    let html = await tab.page.content();

    if (!params.includeScripts)
      html = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

    if (params.sanitize) {
      html = sanitizeHTML(html, {
        removeStyleTags: true,
        removeSvgElements: false,   // keep <svg> containers
        removePathElements: true,   // remove <path>, <circle>, filters etc.
        limitUrlAttributes: true,
        maxAttributeValueLength: 200,
      });
    }

    let regex: RegExp;
    try {
      const pattern = params.isRegex ? params.query : escapeRegex(params.query);
      regex = new RegExp(pattern, 'gi');
    } catch (e: unknown) {
      return {
        code: [`// browser_grep_html`],
        captureSnapshot: false,
        waitForNetwork: false,
        resultOverride: {
          content: [{ type: 'text', text: `Invalid regex pattern: ${(e as Error).message}` }],
        },
      };
    }

    const { snippets, totalMatches } = extractSnippets(
      html, regex, params.contextChars, params.maxMatches,
    );

    const sanitizeNote = params.sanitize
      ? ' (sanitized: styles/paths removed, SVG containers kept)'
      : '';

    const lines: string[] = [
      `## HTML Grep Results`,
      `Query: "${params.query}"${params.isRegex ? ' (regex)' : ''}`,
      `Found: ${totalMatches} match(es) in ${html.length} chars of HTML${sanitizeNote}`,
      `Showing: ${snippets.length} snippet(s)`,
    ];

    if (snippets.length === 0) {
      lines.push('', 'No matches found.');
    } else {
      for (let i = 0; i < snippets.length; i++) {
        lines.push('', `--- Match ${i + 1} of ${totalMatches} ---`, snippets[i]);
      }
    }

    return {
      code: [`// browser_grep_html("${params.query}")`],
      captureSnapshot: false,
      waitForNetwork: false,
      resultOverride: {
        content: [{ type: 'text', text: lines.join('\n') }],
      },
    };
  },
});

// ============================================================
// Disabled: browser_download_page
// ============================================================

const downloadPageSchema = z.object({
  url: z.string().optional().describe('The URL to download. If omitted, uses the currently active tab.'),
  filename: z.string().optional().describe('File name to save the HTML to. Defaults to `page-{timestamp}.html`. If no extension is provided, `.html` will be added.'),
});

// Disabled download tool - keeping code for reference
const downloadPage = defineTool({
  capability: 'core',
  schema: {
    name: 'browser_download_page_disabled',
    title: 'Download page HTML (DISABLED)',
    description: 'Download the current page HTML (or from a provided URL) and save it to a local file. This tool is currently disabled.',
    inputSchema: downloadPageSchema,
    type: 'readOnly',
  },
  handle: async (context, params) => {
    return {
      code: [`// Tool is disabled`],
      action: async () => {
        throw new Error('Download tool is currently disabled. Use browser_view_html or browser_grep_html instead.');
      },
      captureSnapshot: false,
      waitForNetwork: false,
    };
  },
});

export default [
  viewHtml,
  grepHtml,
  // downloadPage, // Disabled - keeping for reference
];
