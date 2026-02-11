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

import type * as playwright from 'playwright';

// Domains and patterns to filter out (analytics, tracking, images, fonts, etc.)
export const FILTERED_DOMAINS = [
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
export const IMAGE_EXTENSIONS = /\.(jpg|jpeg|png|gif|webp|svg|ico|bmp|tiff)(\?|$)/i;

// Image-related paths
export const IMAGE_PATHS = /\/imgs\//i;

// Check if URL should be filtered
export function shouldFilterRequest(url: string, resourceType?: string): boolean {
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
export function extractQueryParams(url: string): Record<string, string> | null {
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

// Safely get resource type from a request (may throw for some request types)
export function getResourceType(request: playwright.Request): string | undefined {
  try {
    return request.resourceType();
  } catch {
    return undefined;
  }
}
