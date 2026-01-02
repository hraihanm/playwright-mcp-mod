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

// Domains and patterns to filter out (analytics, tracking, images, fonts, etc.)
const FILTERED_DOMAINS = [
  'analytics.google.com',
  'google-analytics.com',
  'googletagmanager.com',
  'googleads.g.doubleclick.net',
  'doubleclick.net',
  'analytics.tiktok.com',
  'facebook.com',
  'connect.facebook.net',
  'clarity.ms',
  'j.clarity.ms',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdnjs.cloudflare.com',
  'cdn.jsdelivr.net',
  'google.com/ccm',
  'google.com/pagead',
  'google.com/privacy_sandbox',
  'widget.privy.com',
  'api.privy.com',
  'tracking.midway.la',
  'scripts.clarity.ms',
];

// Image file extensions
const IMAGE_EXTENSIONS = /\.(jpg|jpeg|png|gif|webp|svg|ico|bmp|tiff)(\?|$)/i;

// Image-related paths
const IMAGE_PATHS = /\/imgs\//i;

// Check if URL should be filtered
function shouldFilterRequest(url: string, resourceType?: string): boolean {
  const urlLower = url.toLowerCase();
  
  // Filter by domain
  for (const domain of FILTERED_DOMAINS) {
    if (urlLower.includes(domain)) {
      return true;
    }
  }
  
  // Filter images by extension
  if (IMAGE_EXTENSIONS.test(url)) {
    return true;
  }
  
  // Filter images by path pattern
  if (IMAGE_PATHS.test(url)) {
    return true;
  }
  
  // Filter by resource type if available
  if (resourceType === 'image' || resourceType === 'font') {
    return true;
  }
  
  return false;
}

// Extract query parameters from URL
function extractQueryParams(url: string): Record<string, string> | null {
  try {
    const urlObj = new URL(url);
    const params: Record<string, string> = {};
    urlObj.searchParams.forEach((value, key) => {
      params[key] = value;
    });
    return Object.keys(params).length > 0 ? params : null;
  } catch {
    return null;
  }
}

// Format request for output
function renderSimplifiedRequest(
  request: playwright.Request,
  response: playwright.Response | null
): string {
  const result: string[] = [];
  const method = request.method().toUpperCase();
  const url = request.url();
  
  // Base request line
  let requestLine = `[${method}] ${url}`;
  
  // Add response status inline if available
  if (response) {
    requestLine += ` => [${response.status()}] ${response.statusText()}`;
  }
  
  result.push(requestLine);
  
  // Add query parameters if present
  const queryParams = extractQueryParams(url);
  if (queryParams) {
    // Format query params more readably
    const paramPairs = Object.entries(queryParams)
      .map(([key, value]) => {
        // Truncate very long values
        const truncatedValue = value.length > 100 ? value.substring(0, 100) + '...' : value;
        return `${key}=${truncatedValue}`;
      })
      .join(', ');
    result.push(`  Query Params: ${paramPairs}`);
  }
  
  // Add POST body if present
  const postData = request.postData();
  if (postData) {
    // Truncate very long bodies
    const bodyPreview = postData.length > 500 ? postData.substring(0, 500) + '...' : postData;
    result.push(`  Body: ${bodyPreview}`);
  }
  
  return result.join('\n');
}

const networkSimplifiedSchema = z.object({
  includeImages: z.boolean().optional().default(false).describe('Whether to include image requests in the output. Defaults to false.'),
  includeFonts: z.boolean().optional().default(false).describe('Whether to include font requests in the output. Defaults to false.'),
});

const networkSimplified = defineTool({
  capability: 'core',
  schema: {
    name: 'browser_network_requests_simplified',
    title: 'List network requests (simplified)',
    description: 'Returns filtered network requests excluding analytics, tracking, images, and fonts. Useful for identifying API calls and pagination requests for web scraping. Includes query parameters and POST body data when available.',
    inputSchema: networkSimplifiedSchema,
    type: 'readOnly',
  },

  handle: async (context, params) => {
    const tab = context.currentTabOrDie();
    const requests = tab.requests();
    
    // Filter requests
    const filteredRequests: Array<[playwright.Request, playwright.Response | null]> = [];
    
    for (const [request, response] of requests.entries()) {
      const url = request.url();
      // Safely get resource type - it might not always be available
      let resourceType: string | undefined;
      try {
        resourceType = request.resourceType();
      } catch {
        // resourceType might not be available for all requests
        resourceType = undefined;
      }
      
      // Skip if it's an image and we're not including images
      if (!params.includeImages && (resourceType === 'image' || IMAGE_EXTENSIONS.test(url) || IMAGE_PATHS.test(url))) {
        continue;
      }
      
      // Skip if it's a font and we're not including fonts
      if (!params.includeFonts && resourceType === 'font') {
        continue;
      }
      
      // Apply general filtering
      if (shouldFilterRequest(url, resourceType)) {
        continue;
      }
      
      filteredRequests.push([request, response]);
    }
    
    const log = filteredRequests
      .map(([request, response]) => renderSimplifiedRequest(request, response))
      .join('\n');
    
    return {
      code: [`// <internal code to list simplified network requests>`],
      captureSnapshot: false,
      waitForNetwork: false,
      resultOverride: {
        content: [{ type: 'text', text: log || 'No relevant network requests found.' }]
      },
    };
  },
});

export default [
  networkSimplified,
];

