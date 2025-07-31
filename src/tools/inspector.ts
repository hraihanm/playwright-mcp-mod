/**
      // All matching is now done through semantic similarityder the Apache License, Version 2.0 (the "License");
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
import { defineTool } from './tool.js';
import { generateLocator } from './utils.js';

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

const verifySelectorSchema = z.object({
  element: z.string().describe('Human-readable element description (e.g., "Email input")'),
  selector: z.string().describe('Selector to verify (e.g., "#email")'),
  expected: z.string().describe('Expected text or value to find in the element (e.g., "Sign up" for a button)'),
  attribute: z.string().optional().describe('Optional attribute name to check instead of text content (e.g., "href", "data-id", "value")'),
  details: z.any().optional().describe('Optional details object from browser_inspect_element'),
  batch: z.array(z.object({
    element: z.string().describe('Human-readable element description (e.g., "Email input")'),
    selector: z.string().describe('Selector to verify (e.g., "#email")'),
    expected: z.string().describe('Expected text or value to find in the element (e.g., "Sign up" for a button)'),
    attribute: z.string().optional().describe('Optional attribute name to check instead of text content (e.g., "href", "data-id", "value")'),
    details: z.any().optional().describe('Optional details object from browser_inspect_element'),
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
function findBestSemanticMatch(target: string, properties: Record<string, any>): {
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

    const results = [];

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