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

import { defineTool } from './tool.js';
import * as javascript from '../javascript.js';
import { outputFile } from '../config.js';
import { generateLocator } from './utils.js';

import type * as playwright from 'playwright';
import type { ImageContent, TextContent } from '@modelcontextprotocol/sdk/types.js';

const screenshotSchema = z.object({
  raw: z.boolean().optional().describe('Whether to return without compression (in PNG format). Default is false, which returns a JPEG image.'),
  filename: z.string().optional().describe('File name to save the screenshot to. Defaults to `page-{timestamp}.{png|jpeg}` if not specified.'),
  element: z.string().optional().describe('Human-readable element description used to obtain permission to screenshot the element. If not provided, the screenshot will be taken of viewport. If element is provided, ref must be provided too.'),
  ref: z.string().optional().describe('Exact target element reference from the page snapshot. If not provided, the screenshot will be taken of viewport. If ref is provided, element must be provided too.'),
  fullPage: z.boolean().optional().describe('When true, takes a screenshot of the full scrollable page, instead of the currently visible viewport. Cannot be used with element screenshots.'),
}).refine(data => {
  return !!data.element === !!data.ref;
}, {
  message: 'Both element and ref must be provided or neither.',
  path: ['ref', 'element']
}).refine(data => {
  return !(data.fullPage && (data.element || data.ref));
}, {
  message: 'fullPage cannot be used with element screenshots.',
  path: ['fullPage']
});

const screenshot = defineTool({
  capability: 'core',
  schema: {
    name: 'browser_take_screenshot',
    title: 'Take a screenshot',
    description: `Take a screenshot of the current page. The screenshot includes coordinate metadata that can be used with coordinate-based tools (browser_mouse_click_xy, browser_mouse_move_xy, browser_mouse_drag_xy) to interact with elements by their visual position. Use browser_snapshot for element-based interactions.`,
    inputSchema: screenshotSchema,
    type: 'readOnly',
  },

  handle: async (context, params) => {
    const tab = context.currentTabOrDie();
    const snapshot = tab.snapshotOrDie();
    const fileType = params.raw ? 'png' : 'jpeg';
    const fileName = await outputFile(context.config, params.filename ?? `page-${new Date().toISOString()}.${fileType}`);
    const options: playwright.PageScreenshotOptions = {
      type: fileType,
      quality: fileType === 'png' ? undefined : 50,
      scale: 'css',
      path: fileName,
      ...(params.fullPage !== undefined && { fullPage: params.fullPage })
    };
    const isElementScreenshot = params.element && params.ref;

    const screenshotTarget = isElementScreenshot ? params.element : (params.fullPage ? 'full page' : 'viewport');
    const code = [
      `// Screenshot ${screenshotTarget} and save it as ${fileName}`,
    ];

    const locator = params.ref ? snapshot.refLocator({ element: params.element || '', ref: params.ref }) : null;

    if (locator)
      code.push(`await page.${await generateLocator(locator)}.screenshot(${javascript.formatObject(options)});`);
    else
      code.push(`await page.screenshot(${javascript.formatObject(options)});`);

    const includeBase64 = context.clientSupportsImages();
    
    // Execute screenshot and gather metadata immediately to use resultOverride
    const screenshot = locator ? await locator.screenshot(options) : await tab.page.screenshot(options);
    
    // Gather coordinate metadata
    const viewportSize = tab.page.viewportSize();
    
    // Try to get viewport size, fallback to getting from page
    let viewportWidth = viewportSize?.width ?? null;
    let viewportHeight = viewportSize?.height ?? null;
    
    if (!viewportWidth || !viewportHeight) {
      // Fallback: get viewport size from page
      const viewportInfo = await tab.page.evaluate(() => ({
        width: window.innerWidth,
        height: window.innerHeight
      }));
      viewportWidth = viewportInfo.width;
      viewportHeight = viewportInfo.height;
    }
    
    const pageDimensions = await tab.page.evaluate(() => ({
      width: Math.max(
        document.documentElement.scrollWidth,
        document.documentElement.offsetWidth,
        document.body.scrollWidth,
        document.body.offsetWidth
      ),
      height: Math.max(
        document.documentElement.scrollHeight,
        document.documentElement.offsetHeight,
        document.body.scrollHeight,
        document.body.offsetHeight
      )
    }));

    let elementBoundingBox: { x: number; y: number; width: number; height: number } | null = null;
    let screenshotWidth: number | null = null;
    let screenshotHeight: number | null = null;
    
    if (locator) {
      const boundingBox = await locator.boundingBox();
      if (boundingBox) {
        elementBoundingBox = {
          x: Math.round(boundingBox.x),
          y: Math.round(boundingBox.y),
          width: Math.round(boundingBox.width),
          height: Math.round(boundingBox.height)
        };
        screenshotWidth = elementBoundingBox.width;
        screenshotHeight = elementBoundingBox.height;
      }
    } else if (params.fullPage) {
      screenshotWidth = pageDimensions.width;
      screenshotHeight = pageDimensions.height;
    } else {
      screenshotWidth = viewportWidth;
      screenshotHeight = viewportHeight;
    }

    // Build metadata text
    const metadataLines: string[] = [];
    metadataLines.push(`Screenshot saved: ${fileName} (${screenshotTarget})`);
    metadataLines.push('');
    metadataLines.push('### Coordinate System Information');
    metadataLines.push('The screenshot uses a coordinate system where (0, 0) is at the top-left corner.');
    
    if (isElementScreenshot && elementBoundingBox) {
      metadataLines.push(`- Element bounding box (page coordinates): x=${elementBoundingBox.x}, y=${elementBoundingBox.y}, width=${elementBoundingBox.width}, height=${elementBoundingBox.height}`);
      metadataLines.push(`- Element center (page coordinates): x=${elementBoundingBox.x + Math.round(elementBoundingBox.width / 2)}, y=${elementBoundingBox.y + Math.round(elementBoundingBox.height / 2)}`);
      metadataLines.push(`- Screenshot dimensions: ${screenshotWidth ?? 'unknown'}x${screenshotHeight ?? 'unknown'} pixels`);
      metadataLines.push(`- **Note:** Coordinates in the element screenshot are relative to the element (0,0 is top-left of element). To convert to page coordinates, add the element's x and y offsets.`);
    } else if (params.fullPage) {
      metadataLines.push(`- Page dimensions: ${pageDimensions.width}x${pageDimensions.height} pixels`);
      metadataLines.push(`- Viewport size: ${viewportWidth ?? 'unknown'}x${viewportHeight ?? 'unknown'} pixels`);
      metadataLines.push(`- Screenshot dimensions: ${screenshotWidth ?? 'unknown'}x${screenshotHeight ?? 'unknown'} pixels`);
    } else {
      metadataLines.push(`- Viewport size: ${viewportWidth ?? 'unknown'}x${viewportHeight ?? 'unknown'} pixels`);
      metadataLines.push(`- Page dimensions: ${pageDimensions.width}x${pageDimensions.height} pixels`);
      metadataLines.push(`- Screenshot dimensions: ${screenshotWidth ?? 'unknown'}x${screenshotHeight ?? 'unknown'} pixels`);
    }
    
    metadataLines.push('');
    metadataLines.push('### Using Coordinates');
    metadataLines.push('You can use the coordinate-based tools to interact with elements visible in the screenshot:');
    metadataLines.push('- `browser_mouse_click_xy` - Click at specific coordinates (x, y)');
    metadataLines.push('- `browser_mouse_move_xy` - Move mouse to specific coordinates (x, y)');
    metadataLines.push('- `browser_mouse_drag_xy` - Drag from (startX, startY) to (endX, endY)');
    metadataLines.push('');
    if (!isElementScreenshot) {
      metadataLines.push('**Note:** Coordinates are relative to the viewport for viewport screenshots, or to the full page for full-page screenshots.');
    }

    const content: Array<ImageContent | TextContent> = [];
    
    if (includeBase64) {
      content.push({
        type: 'image',
        data: screenshot.toString('base64'),
        mimeType: fileType === 'png' ? 'image/png' : 'image/jpeg',
      } as ImageContent);
    }
    
    content.push({
      type: 'text',
      text: metadataLines.join('\n')
    } as TextContent);

    // Use resultOverride to suppress console messages, similar to inspector.ts
    return {
      code,
      captureSnapshot: false,
      waitForNetwork: false,
      resultOverride: {
        content
      },
    };
  }
});

export default [
  screenshot,
];
