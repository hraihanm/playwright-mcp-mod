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
import { generateLocator } from './utils.js';

const snapshot = defineTool({
  capability: 'core',
  schema: {
    name: 'browser_snapshot',
    title: 'Page snapshot',
    description: 'Capture accessibility snapshot of the current page, this is better than screenshot',
    inputSchema: z.object({}),
    type: 'readOnly',
  },

  handle: async context => {
    await context.ensureTab();

    return {
      code: [`// <internal code to capture accessibility snapshot>`],
      captureSnapshot: true,
      waitForNetwork: false,
    };
  },
});

export const elementSchema = z.object({
  element: z.string().describe('Human-readable element description used to obtain permission to interact with the element'),
  ref: z.string().describe('Exact target element reference from the page snapshot'),
});

const clickSchema = elementSchema.extend({
  doubleClick: z.boolean().optional().describe('Whether to perform a double click instead of a single click'),
  button: z.enum(['left', 'right', 'middle']).optional().describe('Button to click, defaults to left'),
});

const click = defineTool({
  capability: 'core',
  schema: {
    name: 'browser_click',
    title: 'Click',
    description: 'Perform click on a web page',
    inputSchema: clickSchema,
    type: 'destructive',
  },

  handle: async (context, params) => {
    const tab = context.currentTabOrDie();
    const locator = tab.snapshotOrDie().refLocator(params);
    const button = params.button;
    const buttonAttr = button ? `{ button: '${button}' }` : '';

    const code: string[] = [];
    if (params.doubleClick) {
      code.push(`// Double click ${params.element}`);
      code.push(`await page.${await generateLocator(locator)}.dblclick(${buttonAttr});`);
    } else {
      code.push(`// Click ${params.element}`);
      code.push(`await page.${await generateLocator(locator)}.click(${buttonAttr});`);
    }

    return {
      code,
      action: () => params.doubleClick ? locator.dblclick({ button }) : locator.click({ button }),
      captureSnapshot: true,
      waitForNetwork: true,
    };
  },
});

const drag = defineTool({
  capability: 'core',
  schema: {
    name: 'browser_drag',
    title: 'Drag mouse',
    description: 'Perform drag and drop between two elements',
    inputSchema: z.object({
      startElement: z.string().describe('Human-readable source element description used to obtain the permission to interact with the element'),
      startRef: z.string().describe('Exact source element reference from the page snapshot'),
      endElement: z.string().describe('Human-readable target element description used to obtain the permission to interact with the element'),
      endRef: z.string().describe('Exact target element reference from the page snapshot'),
    }),
    type: 'destructive',
  },

  handle: async (context, params) => {
    const snapshot = context.currentTabOrDie().snapshotOrDie();
    const startLocator = snapshot.refLocator({ ref: params.startRef, element: params.startElement });
    const endLocator = snapshot.refLocator({ ref: params.endRef, element: params.endElement });

    const code = [
      `// Drag ${params.startElement} to ${params.endElement}`,
      `await page.${await generateLocator(startLocator)}.dragTo(page.${await generateLocator(endLocator)});`
    ];

    return {
      code,
      action: () => startLocator.dragTo(endLocator),
      captureSnapshot: true,
      waitForNetwork: true,
    };
  },
});

const hover = defineTool({
  capability: 'core',
  schema: {
    name: 'browser_hover',
    title: 'Hover mouse',
    description: 'Hover over element on page',
    inputSchema: elementSchema,
    type: 'readOnly',
  },

  handle: async (context, params) => {
    const snapshot = context.currentTabOrDie().snapshotOrDie();
    const locator = snapshot.refLocator(params);

    const code = [
      `// Hover over ${params.element}`,
      `await page.${await generateLocator(locator)}.hover();`
    ];

    return {
      code,
      action: () => locator.hover(),
      captureSnapshot: true,
      waitForNetwork: true,
    };
  },
});

const selectOptionSchema = elementSchema.extend({
  values: z.array(z.string()).describe('Array of values to select in the dropdown. This can be a single value or multiple values.'),
});

const selectOption = defineTool({
  capability: 'core',
  schema: {
    name: 'browser_select_option',
    title: 'Select option',
    description: 'Select an option in a dropdown',
    inputSchema: selectOptionSchema,
    type: 'destructive',
  },

  handle: async (context, params) => {
    const snapshot = context.currentTabOrDie().snapshotOrDie();
    const locator = snapshot.refLocator(params);

    const code = [
      `// Select options [${params.values.join(', ')}] in ${params.element}`,
      `await page.${await generateLocator(locator)}.selectOption(${javascript.formatObject(params.values)});`
    ];

    return {
      code,
      action: () => locator.selectOption(params.values).then(() => {}),
      captureSnapshot: true,
      waitForNetwork: true,
    };
  },
});

const inspectElementSchema = z.object({
  element: z.string().describe('Human-readable element description used to obtain permission to interact with the element'),
  ref: z.string().describe('Exact target element reference from the page snapshot'),
  batch: z.array(z.object({
    element: z.string().describe('Human-readable element description used to obtain permission to interact with the element'),
    ref: z.string().describe('Exact target element reference from the page snapshot'),
  })).optional().describe('Optional array of additional elements to inspect in batch'),
});

const inspectElement = defineTool({
  capability: 'core',
  schema: {
    name: 'browser_inspect_element',
    title: 'Inspect element',
    description: 'Reveal the selector and DOM tree details of an internal reference. Can inspect a single element or multiple elements in batch using the batch parameter.',
    inputSchema: inspectElementSchema,
    type: 'readOnly',
  },

  handle: async (context, params) => {
    const tab = context.currentTabOrDie();
    const snapshot = tab.snapshotOrDie();
    
    // Handle both single element and batch requests
    const elementsToInspect = [params, ...(params.batch || [])];
    
    const codePromises = elementsToInspect.map(async (element, index) => [
      `const element${index} = page.${await generateLocator(snapshot.refLocator(element))};`,
      `const details${index} = await element${index}.evaluate(el => ({`,
      `  tagName: el.tagName,`,
      `  id: el.id,`,
      `  className: el.className,`,
      `  textContent: el.textContent?.substring(0, 100),`,
      `  attributes: Object.fromEntries([...el.attributes].map(attr => [attr.name, attr.value])),`,
      `  outerHTML: el.outerHTML,`,
      `  parentHTML: el.parentElement?.outerHTML?.substring(0, 200),`,
      `}));`
    ]);
    
    const codeArrays = await Promise.all(codePromises);
    const code = [
      `// Inspect ${elementsToInspect.length === 1 ? 'element details' : `${elementsToInspect.length} elements in batch`}`,
      ...codeArrays.flat()
    ];

    return {
      code,
      action: async () => {
        const results = [];
        
        for (const element of elementsToInspect) {
          try {
            const locator = snapshot.refLocator(element);
            
            // Get the resolved selector
            const resolvedSelector = await generateLocator(locator);
            
            // Get element details
            const elementDetails = await locator.evaluate((el: Element) => {
              const getPath = (element: Element): string => {
                const path: string[] = [];
                let current = element;
                
                while (current && current !== document.body) {
                  let selector = current.tagName.toLowerCase();
                  
                  if (current.id) {
                    selector += `#${current.id}`;
                  } else if (current.className) {
                    const classes = Array.from(current.classList).join('.');
                    selector += `.${classes}`;
                  }
                  
                  // Add nth-child if needed
                  const siblings = Array.from(current.parentElement?.children || []);
                  const index = siblings.indexOf(current) + 1;
                  if (siblings.length > 1) {
                    selector += `:nth-child(${index})`;
                  }
                  
                  path.unshift(selector);
                  current = current.parentElement!;
                }
                
                return path.join(' > ');
              };

              return {
                tagName: el.tagName,
                id: el.id || null,
                className: el.className || null,
                textContent: el.textContent?.trim().substring(0, 200) || null,
                attributes: Object.fromEntries([...el.attributes].map(attr => [attr.name, attr.value])),
                outerHTML: el.outerHTML,
                innerHTML: el.innerHTML.substring(0, 500),
                cssPath: getPath(el),
                boundingBox: el.getBoundingClientRect(),
                isVisible: 'offsetParent' in el ? el.offsetParent !== null : true,
                computedStyles: {
                  display: getComputedStyle(el).display,
                  visibility: getComputedStyle(el).visibility,
                  opacity: getComputedStyle(el).opacity,
                  position: getComputedStyle(el).position,
                  zIndex: getComputedStyle(el).zIndex,
                }
              };
            });

            results.push({
              element: element.element,
              ref: element.ref,
              resolvedSelector,
              details: elementDetails,
              success: true
            });
          } catch (error) {
            results.push({
              element: element.element,
              ref: element.ref,
              error: error instanceof Error ? error.message : String(error),
              success: false
            });
          }
        }

        // Format the results
        let outputText = '';
        
        if (results.length === 1) {
          const result = results[0];
          if (result.success && result.details) {
            outputText = `# Element Inspection Results for "${result.element}"\n\n` +
                        `## Reference: ${result.ref}\n` +
                        `## Resolved Selector: ${result.resolvedSelector}\n\n` +
                        `## Element Details:\n` +
                        `- **Tag Name:** ${result.details.tagName}\n` +
                        `- **ID:** ${result.details.id || 'None'}\n` +
                        `- **Class:** ${result.details.className || 'None'}\n` +
                        `- **CSS Path:** ${result.details.cssPath}\n` +
                        `- **Visible:** ${result.details.isVisible ? 'Yes' : 'No'}\n` +
                        `- **Position:** ${result.details.boundingBox ? `x: ${result.details.boundingBox.x}, y: ${result.details.boundingBox.y}, width: ${result.details.boundingBox.width}, height: ${result.details.boundingBox.height}` : 'Not available'}\n\n` +
                        `## Computed Styles:\n` +
                        `- **Display:** ${result.details.computedStyles.display}\n` +
                        `- **Visibility:** ${result.details.computedStyles.visibility}\n` +
                        `- **Opacity:** ${result.details.computedStyles.opacity}\n` +
                        `- **Position:** ${result.details.computedStyles.position}\n` +
                        `- **Z-Index:** ${result.details.computedStyles.zIndex}\n\n` +
                        `## Text Content:\n${result.details.textContent || 'None'}\n\n` +
                        `## Attributes:\n${JSON.stringify(result.details.attributes, null, 2)}\n\n` +
                        `## Outer HTML:\n\`\`\`html\n${result.details.outerHTML}\n\`\`\`\n\n` +
                        `## Inner HTML:\n\`\`\`html\n${result.details.innerHTML}\n\`\`\``;
          } else {
            outputText = `Error inspecting element "${result.element}" with reference "${result.ref}": ${result.error}`;
          }
        } else {
          outputText = `# Batch Element Inspection Results (${results.length} elements)\n\n`;
          
          for (let i = 0; i < results.length; i++) {
            const result = results[i];
            outputText += `## ${i + 1}. ${result.element}\n`;
            outputText += `**Reference:** ${result.ref}\n\n`;
            
            if (result.success && result.details) {
              outputText += `**Resolved Selector:** ${result.resolvedSelector}\n` +
                           `**Tag Name:** ${result.details.tagName}\n` +
                           `**ID:** ${result.details.id || 'None'}\n` +
                           `**Class:** ${result.details.className || 'None'}\n` +
                           `**CSS Path:** ${result.details.cssPath}\n` +
                           `**Visible:** ${result.details.isVisible ? 'Yes' : 'No'}\n` +
                           `**Text Content:** ${result.details.textContent?.substring(0, 100) || 'None'}\n\n`;
            } else {
              outputText += `**Error:** ${result.error}\n\n`;
            }
          }
        }

        return {
          content: [
            { 
              type: 'text', 
              text: outputText
            }
          ],
        };
      },
      captureSnapshot: false,
      waitForNetwork: false,
    };
  },
});

export default [
  snapshot,
  click,
  drag,
  hover,
  selectOption,
  inspectElement,
];
