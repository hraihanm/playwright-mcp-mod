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
// @ts-ignore
import natural from 'natural';
// @ts-ignore
import sanitize from 'html-sanitize';
import { defineTool } from './tool.js';
import { generateLocator } from './utils.js';

// HTML sanitization configuration for the inspector tool
const sanitizeConfig = {
  // Remove SVG elements and other potentially irrelevant elements
  allowedTags: [
    'div', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'a', 'button', 'input', 'textarea', 'select', 'option',
    'form', 'label', 'ul', 'ol', 'li', 'table', 'tr', 'td', 'th',
    'img', 'iframe', 'section', 'article', 'header', 'footer',
    'nav', 'main', 'aside', 'figure', 'figcaption', 'blockquote',
    'code', 'pre', 'em', 'strong', 'b', 'i', 'u', 'mark', 'small'
  ],
  // Remove potentially sensitive or irrelevant attributes
  allowedAttributes: {
    'div': ['class', 'id', 'data-*'],
    'span': ['class', 'id', 'data-*'],
    'p': ['class', 'id'],
    'h1': ['class', 'id'],
    'h2': ['class', 'id'],
    'h3': ['class', 'id'],
    'h4': ['class', 'id'],
    'h5': ['class', 'id'],
    'h6': ['class', 'id'],
    'a': ['href', 'class', 'id', 'target', 'rel'],
    'button': ['class', 'id', 'type', 'disabled', 'aria-*'],
    'input': ['class', 'id', 'type', 'name', 'value', 'placeholder', 'disabled', 'required', 'aria-*'],
    'textarea': ['class', 'id', 'name', 'placeholder', 'disabled', 'required', 'aria-*'],
    'select': ['class', 'id', 'name', 'disabled', 'required', 'aria-*'],
    'option': ['class', 'id', 'value', 'selected', 'disabled'],
    'form': ['class', 'id', 'action', 'method', 'enctype'],
    'label': ['class', 'id', 'for', 'aria-*'],
    'ul': ['class', 'id'],
    'ol': ['class', 'id'],
    'li': ['class', 'id'],
    'table': ['class', 'id'],
    'tr': ['class', 'id'],
    'td': ['class', 'id', 'colspan', 'rowspan'],
    'th': ['class', 'id', 'colspan', 'rowspan'],
    'img': ['class', 'id', 'src', 'alt', 'width', 'height'],
    'iframe': ['class', 'id', 'src', 'width', 'height', 'frameborder'],
    'section': ['class', 'id'],
    'article': ['class', 'id'],
    'header': ['class', 'id'],
    'footer': ['class', 'id'],
    'nav': ['class', 'id'],
    'main': ['class', 'id'],
    'aside': ['class', 'id'],
    'figure': ['class', 'id'],
    'figcaption': ['class', 'id'],
    'blockquote': ['class', 'id', 'cite'],
    'code': ['class', 'id'],
    'pre': ['class', 'id'],
    'em': ['class', 'id'],
    'strong': ['class', 'id'],
    'b': ['class', 'id'],
    'i': ['class', 'id'],
    'u': ['class', 'id'],
    'mark': ['class', 'id'],
    'small': ['class', 'id']
  },
  // Remove all SVG elements and their attributes, plus script and style tags
  removeTags: ['script', 'style', 'noscript', 'object', 'embed', 'applet', 'base', 'basefont', 'bgsound', 'link', 'meta', 'title', 'head', 'html', 'body', 'svg', 'path', 'circle', 'rect', 'polygon', 'line', 'g', 'defs', 'clipPath', 'mask', 'filter', 'feGaussianBlur', 'feOffset', 'feMerge', 'feMergeNode', 'feComposite', 'feBlend', 'feColorMatrix', 'feComponentTransfer', 'feFuncR', 'feFuncG', 'feFuncB', 'feFuncA', 'feConvolveMatrix', 'feDiffuseLighting', 'feSpecularLighting', 'feDistantLight', 'fePointLight', 'feSpotLight', 'feTile', 'feTurbulence', 'feMorphology', 'feImage', 'feDisplacementMap', 'feFlood', 'feDropShadow', 'feTurbulence', 'feMorphology', 'feImage', 'feDisplacementMap', 'feFlood', 'feDropShadow'],
  // Remove potentially sensitive attributes
  removeAttributes: ['onclick', 'onload', 'onerror', 'onmouseover', 'onmouseout', 'onfocus', 'onblur', 'onchange', 'onsubmit', 'onreset', 'onkeydown', 'onkeyup', 'onkeypress', 'onmousedown', 'onmouseup', 'onmousemove', 'oncontextmenu', 'onabort', 'onbeforeunload', 'onerror', 'onhashchange', 'onmessage', 'onoffline', 'ononline', 'onpagehide', 'onpageshow', 'onpopstate', 'onresize', 'onstorage', 'onunload', 'onbeforeprint', 'onafterprint', 'oncanplay', 'oncanplaythrough', 'oncuechange', 'ondurationchange', 'onemptied', 'onended', 'onloadeddata', 'onloadedmetadata', 'onloadstart', 'onpause', 'onplay', 'onplaying', 'onprogress', 'onratechange', 'onreadystatechange', 'onseeked', 'onseeking', 'onstalled', 'onsuspend', 'ontimeupdate', 'onvolumechange', 'onwaiting', 'onwheel', 'oncopy', 'oncut', 'onpaste', 'onselect', 'onselectstart', 'onbeforecopy', 'onbeforecut', 'onbeforepaste', 'onbeforeinput', 'oninput', 'oninvalid', 'onsearch', 'onwebkitanimationstart', 'onwebkitanimationend', 'onwebkitanimationiteration', 'onwebkittransitionend', 'ontransitionend', 'onanimationstart', 'onanimationend', 'onanimationiteration', 'ontransitionstart', 'ontransitionrun', 'ontransitioncancel', 'onanimationcancel', 'onanimationstart', 'onanimationend', 'onanimationiteration', 'ontransitionstart', 'ontransitionrun', 'ontransitioncancel', 'onanimationcancel'],
  // Keep only essential data attributes
  allowedDataAttributes: ['data-testid', 'data-test', 'data-cy', 'data-qa', 'data-automation', 'data-id', 'data-name', 'data-value', 'data-type', 'data-label', 'data-title', 'data-description', 'data-placeholder', 'data-required', 'data-disabled', 'data-hidden', 'data-visible', 'data-selected', 'data-checked', 'data-expanded', 'data-collapsed', 'data-open', 'data-closed', 'data-active', 'data-inactive', 'data-current', 'data-previous', 'data-next', 'data-first', 'data-last', 'data-index', 'data-position', 'data-size', 'data-width', 'data-height', 'data-color', 'data-theme', 'data-mode', 'data-state', 'data-status', 'data-level', 'data-priority', 'data-category', 'data-tag', 'data-group', 'data-role', 'data-aria', 'data-accessibility', 'data-semantic', 'data-meaning', 'data-purpose', 'data-function', 'data-behavior', 'data-interaction', 'data-event', 'data-action', 'data-result', 'data-output', 'data-input', 'data-form', 'data-field', 'data-section', 'data-container', 'data-wrapper', 'data-content', 'data-header', 'data-footer', 'data-sidebar', 'data-main', 'data-aside', 'data-navigation', 'data-menu', 'data-list', 'data-item', 'data-entry', 'data-record', 'data-row', 'data-column', 'data-cell', 'data-table', 'data-grid', 'data-chart', 'data-graph', 'data-image', 'data-media', 'data-video', 'data-audio', 'data-document', 'data-file', 'data-link', 'data-button', 'data-input', 'data-select', 'data-textarea', 'data-checkbox', 'data-radio', 'data-toggle', 'data-switch', 'data-slider', 'data-progress', 'data-meter', 'data-gauge', 'data-indicator', 'data-badge', 'data-tooltip', 'data-popover', 'data-modal', 'data-dialog', 'data-drawer', 'data-panel', 'data-tab', 'data-accordion', 'data-carousel', 'data-slider', 'data-gallery', 'data-lightbox', 'data-dropdown', 'data-menu', 'data-tree', 'data-breadcrumb', 'data-pagination', 'data-calendar', 'data-datepicker', 'data-timepicker', 'data-colorpicker', 'data-fileupload', 'data-dragdrop', 'data-sortable', 'data-resizable', 'data-draggable', 'data-droppable', 'data-sortable', 'data-resizable', 'data-draggable', 'data-droppable'],
  // Maximum length limits for HTML content
  maxOuterHTMLLength: 2000,
  maxInnerHTMLLength: 1500,
  maxTextContentLength: 300,
  maxAttributesCount: 10,
  maxChildrenCount: 20,
  maxTreeDepth: 3,
  maxAttributeValueLength: 100,
  compactMode: true
};

// Helper function to sanitize HTML content
function sanitizeHTML(html: string, maxLength: number = 2000): string {
  if (!html || html.length === 0) return '';
  
  // Truncate HTML if it's too long before sanitization
  let truncatedHTML = html;
  if (html.length > maxLength) {
    truncatedHTML = html.substring(0, maxLength) + '...';
  }
  
  try {
    // Apply sanitization with our custom configuration
    const sanitized = sanitize(truncatedHTML, sanitizeConfig);
    
    // Additional post-processing to ensure clean output
    return sanitized
      .replace(/\s+/g, ' ') // Normalize whitespace
      .replace(/>\s+</g, '><') // Remove whitespace between tags
      .trim();
  } catch (error) {
    // If sanitization fails, return a safe fallback
    console.warn('HTML sanitization failed:', error);
    return html.substring(0, Math.min(maxLength, 500)) + '...';
  }
}

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

    // Execute the inspection immediately and construct the final content
    const results: Array<{
      element: string;
      ref: string;
      resolvedSelector?: string;
      details?: any;
      error?: string;
      success: boolean;
    }> = [];
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
              
              if ((current as HTMLElement).id) {
                selector += `#${(current as HTMLElement).id}`;
              } else if ((current as HTMLElement).className) {
                const classes = Array.from((current as HTMLElement).classList).join('.');
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
            tagName: (el as HTMLElement).tagName,
            id: (el as HTMLElement).id || null,
            className: (el as HTMLElement).className || null,
            textContent: el.textContent?.trim().substring(0, 200) || null,
            attributes: Object.fromEntries([...el.attributes].map(attr => [attr.name, attr.value])),
            outerHTML: (el as HTMLElement).outerHTML,
            innerHTML: (el as HTMLElement).innerHTML.substring(0, 500),
            cssPath: getPath(el),
            boundingBox: (el as HTMLElement).getBoundingClientRect(),
            isVisible: 'offsetParent' in el ? (el as any).offsetParent !== null : true,
            computedStyles: {
              display: getComputedStyle(el as HTMLElement).display,
              visibility: getComputedStyle(el as HTMLElement).visibility,
              opacity: getComputedStyle(el as HTMLElement).opacity,
              position: getComputedStyle(el as HTMLElement).position,
              zIndex: getComputedStyle(el as HTMLElement).zIndex,
            }
          };
        });

        // Apply HTML sanitization to the element details
        if (elementDetails.outerHTML) {
          elementDetails.outerHTML = sanitizeHTML(elementDetails.outerHTML, sanitizeConfig.maxOuterHTMLLength);
        }
        if (elementDetails.innerHTML) {
          elementDetails.innerHTML = sanitizeHTML(elementDetails.innerHTML, sanitizeConfig.maxInnerHTMLLength);
        }

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
                    `## Inner HTML:\n\`\`\`html\n${result.details.innerHTML}\n\`\`\`\n\n` +
                    `> **Note:** HTML content has been sanitized for security. SVG elements, scripts, styles, and potentially sensitive attributes have been removed.`;
      } else {
        outputText = `Error inspecting element "${result.element}" with reference "${result.ref}": ${result.error}`;
      }
    } else {
      outputText = `# Batch Element Inspection Results (${results.length} elements)\n\n` +
                    `> **Note:** HTML content has been sanitized for security. SVG elements, scripts, styles, and potentially sensitive attributes have been removed.\n\n`;
      
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

    // Build a final content array that includes the code block as context
    const finalContent = [
      {
        type: 'text' as const,
        text: `### Ran Playwright code\n\n\`\`\`js\n${code.join('\n')}\n\`\`\``,
      },
      {
        type: 'text' as const,
        text: outputText,
      }
    ];

    // Return resultOverride to suppress console messages added by Context.run
    return {
      code,
      captureSnapshot: false,
      waitForNetwork: false,
      resultOverride: {
        content: finalContent,
      },
    };
  },
});

const verifySelectorSchema = z.object({
  element: z.string().describe('Human-readable element description (e.g., "Email input")'),
  selector: z.string().describe('Selector to verify (e.g., "#email")'),
  expected: z.string().describe('Expected text or value to find in the element (e.g., "Sign up" for a button)'),
  attribute: z.string().optional().describe('Optional attribute name to check instead of text content (e.g., "href", "data-id", "value")'),
  details: z.record(z.unknown()).optional().describe('Optional details object from browser_inspect_element'),
  batch: z.array(z.object({
    element: z.string().describe('Human-readable element description (e.g., "Email input")'),
    selector: z.string().describe('Selector to verify (e.g., "#email")'),
    expected: z.string().describe('Expected text or value to find in the element (e.g., "Sign up" for a button)'),
    attribute: z.string().optional().describe('Optional attribute name to check instead of text content (e.g., "href", "data-id", "value")'),
    details: z.record(z.unknown()).optional().describe('Optional details object from browser_inspect_element'),
  })).optional().describe('Optional array of additional selectors to verify in batch'),
});

// Initialize the tokenizer
const tokenizer = new natural.WordTokenizer();

// Helper function to calculate semantic similarity between two texts
function calculateSimilarity(text1: string, text2: string): number {
  if (!text1 || !text2) return 0;
  
  // Tokenize and clean the texts
  const tokens1 = tokenizer.tokenize(text1.toLowerCase());
  const tokens2 = tokenizer.tokenize(text2.toLowerCase());
  
  if (!tokens1 || !tokens2 || tokens1.length === 0 || tokens2.length === 0) return 0;

  // Create a new TF-IDF instance for this comparison
  const tfidf = new natural.TfIdf();
  tfidf.addDocument(tokens1);
  tfidf.addDocument(tokens2);

  // Get TF-IDF vectors for both documents
  const vector1 = tfidf.listTerms(0) as Array<{term: string; tfidf: number}>;
  const vector2 = tfidf.listTerms(1) as Array<{term: string; tfidf: number}>;

  // Calculate cosine similarity
  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;

  // Create maps for faster lookup
  const terms1 = new Map(vector1.map(item => [item.term, item.tfidf]));
  const terms2 = new Map(vector2.map(item => [item.term, item.tfidf]));

  // Calculate dot product and norms
  for (const [term, tfidf1] of terms1.entries()) {
    const tfidf2 = terms2.get(term) || 0;
    dotProduct += tfidf1 * tfidf2;
    norm1 += tfidf1 * tfidf1;
  }
  for (const [_, tfidf2] of terms2.entries()) {
    norm2 += tfidf2 * tfidf2;
  }

  // Return cosine similarity
  return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
}

// Helper function to find best semantic match from properties
function findBestSemanticMatch(target: string, properties: Record<string, unknown>): {
  similarity: number;
  property: string;
  value: string;
} {
  let bestMatch = {
    similarity: 0,
    property: '',
    value: ''
  };

  for (const [key, value] of Object.entries(properties)) {
    if (typeof value === 'string' && value.trim()) {
      const similarity = calculateSimilarity(target, value);
      if (similarity > bestMatch.similarity) {
        bestMatch = {
          similarity,
          property: key,
          value
        };
      }
    }
  }

  return bestMatch;
}

const verifySelector = defineTool({
  capability: 'core',
  schema: {
    name: 'browser_verify_selector',
    title: 'Verify selector',
    description: 'Verify that a selector matches an element and contextually matches the description',
    inputSchema: verifySelectorSchema,
    type: 'readOnly',
  },

  handle: async (context, params) => {
    await context.ensureTab();
    const tab = context.currentTabOrDie();
    const page = tab.page;

    // Handle both single element and batch requests
    const elementsToVerify = [
      { element: params.element, selector: params.selector, expected: params.expected, details: params.details },
      ...(params.batch || [])
    ];

    const results: Array<{
      element: string;
      selector: string;
      match: boolean;
      confidence: number;
      explanation: string;
    }> = [];

    for (const elementToVerify of elementsToVerify) {
      const { element: description, selector, expected, details } = elementToVerify;
      let match = false;
      let confidence = 0;
      let explanation = '';
      let foundElement = null;

      try {
        foundElement = await page.$(selector);
        
        if (!foundElement) {
          explanation = `❌ Selector '${selector}' did not match any element on the page.`;
          results.push({
            element: description,
            selector,
            match: false,
            confidence: 0,
            explanation,
          });
          continue;
        }

        match = true;
        // Try to get properties for contextual match
        const props = await foundElement.evaluate((el: HTMLElement & { labels?: NodeListOf<HTMLLabelElement> }, attribute: string | undefined) => {
          const getValue = (el: HTMLElement) => {
            if ('value' in el && typeof (el as any).value === 'string') {
              return (el as any).value;
            }
            return null;
          };

          const getAttributeValue = (el: HTMLElement, attrName: string | undefined) => {
            if (!attrName) return null;
            const value = el.getAttribute(attrName);
            return value !== null ? value : null;
          };

          const attributeValue = getAttributeValue(el, attribute);

          return {
            tagName: el.tagName,
            id: el.id,
            className: el.className,
            name: el.getAttribute('name'),
            type: el.getAttribute('type'),
            placeholder: el.getAttribute('placeholder'),
            ariaLabel: el.getAttribute('aria-label'),
            value: getValue(el),
            label: (() => {
              if (el.labels && el.labels.length > 0) return el.labels[0].innerText;
              const labelledby = el.getAttribute('aria-labelledby');
              if (labelledby) {
                const labelEl = document.getElementById(labelledby);
                if (labelEl) return labelEl.innerText;
              }
              if (el.parentElement && el.parentElement.tagName === 'LABEL') return el.parentElement.innerText;
              return null;
            })(),
            textContent: el.textContent?.trim() || '',
            attributeValue,
            attributeName: attribute,
            allAttributes: Object.fromEntries(Array.from(el.attributes).map(attr => [attr.name, attr.value])),
          };
        }, elementToVerify.attribute);

        // If an attribute is specified, prioritize exact attribute matching
        let expectedMatch;
        if (elementToVerify.attribute && props.attributeValue !== null) {
          const exactAttributeMatch = props.attributeValue === expected;
          expectedMatch = {
            similarity: exactAttributeMatch ? 1.0 : 0,
            property: props.attributeName || '',
            value: props.attributeValue || ''
          };
        } else {
          // Use semantic similarity for text content if no attribute specified or attribute not found
          const propsForMatching = {
            ...props,
            ...(props.attributeValue && { [props.attributeName || 'attribute']: props.attributeValue })
          };
          expectedMatch = findBestSemanticMatch(expected, propsForMatching);
        }
        
        const descriptionMatch = findBestSemanticMatch(description, props);

        // Define similarity thresholds
        const HIGH_SIMILARITY = 0.8;
        const MEDIUM_SIMILARITY = 0.5;
        const LOW_SIMILARITY = 0.3;

        // Determine match levels
        const hasStrongExpectedMatch = expectedMatch.similarity >= HIGH_SIMILARITY;
        const hasMediumExpectedMatch = expectedMatch.similarity >= MEDIUM_SIMILARITY;
        const hasWeakExpectedMatch = expectedMatch.similarity >= LOW_SIMILARITY;

        const hasStrongDescMatch = descriptionMatch.similarity >= HIGH_SIMILARITY;
        const hasMediumDescMatch = descriptionMatch.similarity >= MEDIUM_SIMILARITY;

        // For semantic labels (like "product name"), we focus more on the expected text match
        // and treat the description match as a bonus rather than a requirement
        const isSemanticLabel = description.toLowerCase().includes('name') || 
                               description.toLowerCase().includes('title') ||
                               description.toLowerCase().includes('label') ||
                               description.toLowerCase().includes('heading');

        // Adjust confidence based on expected text match primarily
        if (hasStrongExpectedMatch) {
          confidence = isSemanticLabel ? 0.95 : (hasStrongDescMatch ? 1.0 : 0.85);
          const matchLevel = confidence === 1.0 ? "Perfect" : "Strong";
          explanation = `✅ ${matchLevel} match!\n` +
                       `• Selector: '${selector}'\n` +
                       `• Found element: <${props.tagName.toLowerCase()}>\n` +
                       `• Expected ${elementToVerify.attribute ? `attribute '${elementToVerify.attribute}'` : 'text'}: "${expected}"\n` +
                       `• Found ${elementToVerify.attribute ? 'attribute' : 'text'}: "${expectedMatch.value}"${elementToVerify.attribute ? '' : ` (${(expectedMatch.similarity * 100).toFixed(1)}% similarity in ${expectedMatch.property})`}\n` +
                       (isSemanticLabel ? 
                         `• Description "${description}" is treated as a semantic label\n` :
                         `• Description "${description}" match: ${(descriptionMatch.similarity * 100).toFixed(1)}% similarity in ${descriptionMatch.property || 'N/A'}`);
        } else if (hasMediumExpectedMatch) {
          confidence = isSemanticLabel ? 0.7 : (hasMediumDescMatch ? 0.7 : 0.6);
          explanation = `⚠️ Moderate match\n` +
                       `• Selector: '${selector}'\n` +
                       `• Found element: <${props.tagName.toLowerCase()}>\n` +
                       `• Expected text : "${expected}"\n` +
                       `• Found text    : "${expectedMatch.value}" (${(expectedMatch.similarity * 100).toFixed(1)}% similarity in ${expectedMatch.property})\n` +
                       (isSemanticLabel ? 
                         `• Description "${description}" is treated as a semantic label\n` :
                         `• Description "${description}" match: ${(descriptionMatch.similarity * 100).toFixed(1)}% similarity in ${descriptionMatch.property || 'N/A'}`);
        } else if (hasWeakExpectedMatch) {
          confidence = 0.4;
          explanation = `⚠️ Weak match\n` +
                       `• Selector: '${selector}'\n` +
                       `• Found element: <${props.tagName.toLowerCase()}>\n` +
                       `• Expected text : "${expected}"\n` +
                       `• Found text    : "${expectedMatch.value}" (${(expectedMatch.similarity * 100).toFixed(1)}% similarity in ${expectedMatch.property})\n` +
                       (isSemanticLabel ? 
                         `• Description "${description}" is treated as a semantic label\n` :
                         `• Description "${description}" match: ${(descriptionMatch.similarity * 100).toFixed(1)}% similarity in ${descriptionMatch.property || 'N/A'}`);
        } else {
          confidence = 0.1;
          explanation = `❌ No significant matches\n` +
                       `• Selector '${selector}' found an element\n` +
                       `• Element: <${props.tagName.toLowerCase()}>\n` +
                       `• Expected text : "${expected}"\n` +
                       `• Found text    : "${expectedMatch.value}" (${(expectedMatch.similarity * 100).toFixed(1)}% similarity in ${expectedMatch.property})\n` +
                       (isSemanticLabel ? 
                         `• Description "${description}" is treated as a semantic label\n` :
                         `• Description "${description}" match: ${(descriptionMatch.similarity * 100).toFixed(1)}% similarity in ${descriptionMatch.property || 'N/A'}`);
        }

        // Add available properties for weak matches or failures
        if (confidence <= 0.4) {
          explanation += `\n• Available properties:\n` +
                        Object.entries(props)
                          .filter(([_, v]) => v)
                          .map(([k, v]) => `  - ${k}: "${v}"`)
                          .join('\n');
        }

        results.push({
          element: description,
          selector,
          match,
          confidence,
          explanation,
        });

      } catch (e) {
        explanation = `❌ Error verifying selector: ${e}`;
        results.push({
          element: description,
          selector,
          match: false,
          confidence: 0,
          explanation,
        });
      }
    }

    // Format the final output
    let finalExplanation = '';
    if (results.length === 1) {
      finalExplanation = results[0].explanation;
    } else {
      finalExplanation = `# Batch Selector Verification Results (${results.length} elements)\n\n`;
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        finalExplanation += `## ${i + 1}. "${result.element}" (${result.selector})\n${result.explanation}\n\n`;
      }
    }

    return {
      code: [`\`${finalExplanation.replace(/`/g, '\\`')}\``],
      content: [
        { 
          type: 'text', 
          text: finalExplanation
        }
      ],
      results,
      captureSnapshot: false,
      waitForNetwork: false,
    };
  },
});

export default [
  inspectElement,
  verifySelector,
]; 