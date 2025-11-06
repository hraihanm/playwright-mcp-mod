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

// HTML Sanitization Configuration
// This configuration controls what gets removed/limited from HTML content
const SANITIZATION_CONFIG = {
  // Tags to remove by default (useless tags that don't contain important content)
  removeTags: [
    'style', 'svg', 'path', 'circle', 'rect', 'polygon', 'line', 'g', 'defs', 
    'clipPath', 'mask', 'filter', 'feGaussianBlur', 'feOffset', 'feMerge', 
    'feMergeNode', 'feComposite', 'feBlend', 'feColorMatrix', 'feComponentTransfer', 
    'feFuncR', 'feFuncG', 'feFuncB', 'feFuncA', 'feConvolveMatrix', 'feDiffuseLighting', 
    'feSpecularLighting', 'feDistantLight', 'fePointLight', 'feSpotLight', 'feTile', 
    'feTurbulence', 'feMorphology', 'feImage', 'feDisplacementMap', 'feFlood', 'feDropShadow'
  ],
  
  // Attribute value limits to prevent extremely long URLs/attributes
  attributeLimits: {
    href: 300,      // Links
    src: 300,       // Images, scripts, etc.
    srcset: 300,    // Image srcset
    'data-src': 500, // Lazy loading images
    style: 200,     // Inline styles
    class: 500,     // CSS classes
    id: 500,        // Element IDs
    data: 500       // Data attributes
  },
  
  // Default sanitization options
  defaults: {
    removeStyleTags: true,
    removeSvgElements: true,
    limitUrlAttributes: true,
    maxAttributeValueLength: 200
  }
};

// Simple configuration interface for HTML sanitization
interface SanitizeConfig {
  removeStyleTags?: boolean;
  removeSvgElements?: boolean;
  limitUrlAttributes?: boolean;
  maxAttributeValueLength?: number;
}

// Helper function to create sanitization configuration based on options
function createSanitizeConfig(options: SanitizeConfig = {}) {
  const config = {
    allowedTags: [
      'div', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'a', 'button', 'input', 'textarea', 'select', 'option',
      'form', 'label', 'ul', 'ol', 'li', 'table', 'tr', 'td', 'th',
      'img', 'iframe', 'section', 'article', 'header', 'footer',
      'nav', 'main', 'aside', 'figure', 'figcaption', 'blockquote',
      'code', 'pre', 'em', 'strong', 'b', 'i', 'u', 'mark', 'small',
      'script', 'noscript', 'object', 'embed', 'applet', 
      'base', 'basefont', 'bgsound', 'link', 'meta', 'title', 
      'head', 'html', 'body'
    ],
    allowedAttributes: '*',
    removeTags: [] as string[],
    removeAttributes: [] as string[],
    compactMode: true
  };
  
  // Add tags to remove based on options
  const tagsToRemove = [...SANITIZATION_CONFIG.removeTags];
  
  if (options.removeStyleTags !== false) {
    tagsToRemove.push('style');
  }
  
  if (options.removeSvgElements !== false) {
    const svgTags = ['svg', 'path', 'circle', 'rect', 'polygon', 'line', 'g', 'defs', 'clipPath', 'mask', 'filter', 'feGaussianBlur', 'feOffset', 'feMerge', 'feMergeNode', 'feComposite', 'feBlend', 'feColorMatrix', 'feComponentTransfer', 'feFuncR', 'feFuncG', 'feFuncB', 'feFuncA', 'feConvolveMatrix', 'feDiffuseLighting', 'feSpecularLighting', 'feDistantLight', 'fePointLight', 'feSpotLight', 'feTile', 'feTurbulence', 'feMorphology', 'feImage', 'feDisplacementMap', 'feFlood', 'feDropShadow'];
    tagsToRemove.push(...svgTags);
  }
  
  config.removeTags = [...new Set(tagsToRemove)]; // Remove duplicates
  
  return config;
}

// Helper function to limit attribute values in HTML
function limitAttributeValues(html: string, options: SanitizeConfig = {}): string {
  if (options.limitUrlAttributes === false) {
    return html;
  }
  
  const maxLength = options.maxAttributeValueLength || SANITIZATION_CONFIG.defaults.maxAttributeValueLength;
  const limits = SANITIZATION_CONFIG.attributeLimits;
  
  // Apply attribute value limits
  return html.replace(/(\w+)=["']([^"']*)["']/g, (match, attr, value) => {
    const attrMaxLength = limits[attr.toLowerCase() as keyof typeof limits] || maxLength;
    if (value.length > attrMaxLength) {
      return `${attr}="${value.substring(0, attrMaxLength)}..."`;
    }
    return match;
  });
}

// Helper function to sanitize HTML content without truncating
function sanitizeHTML(html: string, options: SanitizeConfig = {}): string {
  if (!html || html.length === 0) return '';
  
  try {
    // Create sanitization configuration
    const sanitizeConfig = createSanitizeConfig(options);
    
    // Apply sanitization
    let sanitized = sanitize(html, sanitizeConfig);
    
    // Apply attribute value limits
    sanitized = limitAttributeValues(sanitized, options);
    
    // Additional post-processing to ensure clean output
    return sanitized
      .replace(/\s+/g, ' ') // Normalize whitespace
      .replace(/>\s+</g, '><') // Remove whitespace between tags
      .trim();
  } catch (error) {
    // If sanitization fails, return the original HTML
    console.warn('HTML sanitization failed:', error);
    return html;
  }
}

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

    // Execute the action immediately to get HTML content
    let html = await tab.page.content();
    
    // Remove scripts if not requested
    if (!params.includeScripts) {
      html = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    }
    
    // Sanitize if requested using defaults from SANITIZATION_CONFIG
    if (params.isSanitized) {
      const sanitizeOptions: SanitizeConfig = {
        removeStyleTags: SANITIZATION_CONFIG.defaults.removeStyleTags,
        removeSvgElements: SANITIZATION_CONFIG.defaults.removeSvgElements,
        limitUrlAttributes: SANITIZATION_CONFIG.defaults.limitUrlAttributes,
        maxAttributeValueLength: SANITIZATION_CONFIG.defaults.maxAttributeValueLength
      };
      
      html = sanitizeHTML(html, sanitizeOptions);
    }

    return {
      code,
      captureSnapshot: false,
      waitForNetwork: false,
      resultOverride: {
        content: [
          {
            type: 'text' as const,
            text: html
          }
        ]
      },
    };
  },
});

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
    // Tool is disabled - return error message
    return {
      code: [`// Tool is disabled`],
      action: async () => {
        throw new Error('Download tool is currently disabled. Use browser_view_html instead.');
      },
      captureSnapshot: false,
      waitForNetwork: false,
    };
  },
});

export default [
  viewHtml,
  // downloadPage, // Disabled - keeping for reference
];


