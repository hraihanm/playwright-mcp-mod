import { z } from 'zod';
import { defineTool } from '../tool.js';

// ============================================================
// Tool A: browser_count_selector
// ============================================================

const countSelectorSchema = z.object({
  selector: z.string().describe('CSS selector to count matches for'),
  expected_min: z.number().optional().describe('Warn if count is less than this'),
  expected_max: z.number().optional().describe('Warn if count is greater than this'),
});

const countSelector = defineTool({
  capability: 'core',
  schema: {
    name: 'browser_count_selector',
    title: 'Count selector matches',
    description: 'Count how many elements match a CSS selector on the current page. Optionally warn if count is outside an expected range. Useful for validating selectors before writing parser code.',
    inputSchema: countSelectorSchema,
    type: 'readOnly',
  },
  handle: async (context, params) => {
    const tab = context.currentTabOrDie();
    const count = await tab.page.evaluate((sel: string) => document.querySelectorAll(sel).length, params.selector);

    let warning: string | null = null;
    if (params.expected_min !== undefined && count < params.expected_min)
      warning = `Count ${count} is less than expected minimum ${params.expected_min}`;
    else if (params.expected_max !== undefined && count > params.expected_max)
      warning = `Count ${count} is greater than expected maximum ${params.expected_max}`;

    const result = { selector: params.selector, count, valid: true, warning };

    return {
      code: [`// browser_count_selector("${params.selector}")`],
      captureSnapshot: false,
      waitForNetwork: false,
      resultOverride: {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      },
    };
  },
});

// ============================================================
// Tool B: browser_extract_images
// ============================================================

const extractImagesSchema = z.object({
  container_selector: z.string().describe('CSS selector for the image gallery container element'),
  limit: z.number().optional().default(10).describe('Max images to return. Default: 10'),
});

const extractImages = defineTool({
  capability: 'core',
  schema: {
    name: 'browser_extract_images',
    title: 'Extract images from container',
    description: 'Extract image URLs from a gallery/container element. Checks src, data-src, data-lazy, data-original, data-zoom-image, srcset, and CSS background-image in priority order. Deduplicates results and identifies lazy-load patterns.',
    inputSchema: extractImagesSchema,
    type: 'readOnly',
  },
  handle: async (context, params) => {
    const tab = context.currentTabOrDie();

    const result = await tab.page.evaluate(({ containerSelector, limit }: { containerSelector: string; limit: number }) => {
      const container = document.querySelector(containerSelector);
      if (!container) {
        return { error: `Container not found: ${containerSelector}` };
      }

      const imgs = Array.from(container.querySelectorAll('img'));
      const imageExtRe = /\.(jpe?g|png|webp|gif|svg|avif|bmp)(\?|$)/i;

      const images: Array<{ url: string; source_attr: string; index: number }> = [];
      const seen = new Set<string>();
      let lazyPattern: string | null = null;

      const addImage = (url: string, attr: string, index: number) => {
        if (!url || url.startsWith('data:') || seen.has(url)) return;
        seen.add(url);
        images.push({ url, source_attr: attr, index });
        if (attr !== 'src' && attr !== 'background-image' && !lazyPattern)
          lazyPattern = attr;
      };

      for (let i = 0; i < imgs.length && images.length < limit; i++) {
        const img = imgs[i];
        const dataSrc = img.getAttribute('data-src');
        const dataLazy = img.getAttribute('data-lazy');
        const dataOriginal = img.getAttribute('data-original');
        const dataZoom = img.getAttribute('data-zoom-image');
        const srcset = img.getAttribute('srcset');
        const src = img.getAttribute('src');

        if (dataZoom) addImage(dataZoom, 'data-zoom-image', i);
        else if (dataOriginal) addImage(dataOriginal, 'data-original', i);
        else if (dataSrc) addImage(dataSrc, 'data-src', i);
        else if (dataLazy) addImage(dataLazy, 'data-lazy', i);
        else if (src && !src.startsWith('data:')) addImage(src, 'src', i);
        else if (srcset) {
          const firstUrl = srcset.split(',')[0].trim().split(/\s+/)[0];
          if (firstUrl) addImage(firstUrl, 'srcset', i);
        } else {
          // Check CSS background-image
          const style = window.getComputedStyle(img);
          const bg = style.backgroundImage;
          if (bg && bg !== 'none') {
            const bgMatch = bg.match(/url\(["']?([^"')]+)["']?\)/);
            if (bgMatch && bgMatch[1]) addImage(bgMatch[1], 'background-image', i);
          }
        }

        // Also check parent <a> href
        if (images.length < limit) {
          const parent = img.parentElement;
          if (parent && parent.tagName === 'A') {
            const href = parent.getAttribute('href');
            if (href && imageExtRe.test(href)) addImage(href, 'parent-a-href', i);
          }
        }
      }

      return {
        images,
        count: images.length,
        primary_url: images.length > 0 ? images[0].url : null,
        lazy_load_pattern: lazyPattern,
      };
    }, { containerSelector: params.container_selector, limit: params.limit });

    const text = 'error' in result
      ? JSON.stringify({ error: result.error }, null, 2)
      : JSON.stringify(result, null, 2);

    return {
      code: [`// browser_extract_images("${params.container_selector}")`],
      captureSnapshot: false,
      waitForNetwork: false,
      resultOverride: {
        content: [{ type: 'text', text }],
      },
    };
  },
});

// ============================================================
// Tool C: browser_detect_pagination
// ============================================================

const detectPaginationSchema = z.object({
  current_url: z.string().describe('Current listing page URL — used for URL pattern analysis'),
});

const detectPagination = defineTool({
  capability: 'core',
  schema: {
    name: 'browser_detect_pagination',
    title: 'Detect pagination strategy',
    description: 'Detect how pagination works on the current listing page. Checks for count-based (total results text), next button, and URL pattern strategies. Returns confidence score, selectors, and total page estimate.',
    inputSchema: detectPaginationSchema,
    type: 'readOnly',
  },
  handle: async (context, params) => {
    const tab = context.currentTabOrDie();

    const browserResult = await tab.page.evaluate(() => {
      interface CountResult {
        selector: string;
        text: string;
        total: number | null;
        perPage: number | null;
      }
      interface NextResult {
        selector: string;
        text: string;
        href: string | null;
      }

      // --- Count-based detection ---
      const countSelectors = [
        '[class*="result"]', '[class*="count"]', '[class*="total"]',
        '.pagination-info', '[data-total]', '[data-count]',
      ];
      const countPatterns = [
        /(\d[\d,]*)\s*(?:items?|products?|results?)/i,
        /showing\s+(\d+)\s*[-–]\s*(\d+)\s+of\s+(\d[\d,]*)/i,
        /(\d+)\s*[-–]\s*(\d+)\s+of\s+(\d[\d,]*)/i,
        /(\d[\d,]*)\s+(?:of|total)/i,
      ];

      let bestCount: CountResult | null = null;

      for (const sel of countSelectors) {
        const els = document.querySelectorAll(sel);
        for (const el of Array.from(els)) {
          const text = (el.textContent || '').trim();
          for (const pat of countPatterns) {
            const m = text.match(pat);
            if (m) {
              // Try to extract total and perPage
              let total: number | null = null;
              let perPage: number | null = null;

              if (m[3]) {
                // "showing X-Y of Z" pattern
                total = parseInt(m[3].replace(/,/g, ''), 10);
                const from = parseInt(m[1].replace(/,/g, ''), 10);
                const to = parseInt(m[2].replace(/,/g, ''), 10);
                perPage = to - from + 1;
              } else if (m[1]) {
                total = parseInt(m[1].replace(/,/g, ''), 10);
              }

              if (!bestCount && total !== null) {
                bestCount = { selector: sel, text: text.substring(0, 100), total, perPage };
              }
            }
          }
          if (bestCount) break;
        }
        if (bestCount) break;
      }

      // Also check all elements for "X of Y" pattern if nothing found
      if (!bestCount) {
        const allText = document.body ? document.body.innerText : '';
        const ofPat = /(\d[\d,]*)\s*(?:items?|products?|results?|total)/i;
        const m = allText.match(ofPat);
        if (m) {
          bestCount = {
            selector: 'body (text scan)',
            text: m[0],
            total: parseInt(m[1].replace(/,/g, ''), 10),
            perPage: null,
          };
        }
      }

      // --- Next button detection ---
      const nextSelectors = [
        "a[rel='next']",
        '[aria-label*="next" i]',
        '[class*="next"]',
        '.pagination a:last-child',
        'button[class*="next"]',
        'nav a:last-child',
        '[class*="pagination"] a:last-child',
      ];

      let bestNext: NextResult | null = null;
      for (const sel of nextSelectors) {
        try {
          const el = document.querySelector(sel);
          if (el) {
            const text = (el.textContent || '').trim().substring(0, 50);
            const href = (el as HTMLAnchorElement).href || null;
            bestNext = { selector: sel, text, href };
            break;
          }
        } catch {
          // skip invalid selectors
        }
      }

      return { bestCount, bestNext };
    });

    // URL pattern analysis
    const url = params.current_url;
    const urlPatterns = [
      { pattern: '?page=', placeholder: '?page={n}' },
      { pattern: '&page=', placeholder: '&page={n}' },
      { pattern: '/page/', placeholder: '/page/{n}' },
      { pattern: '?p=', placeholder: '?p={n}' },
      { pattern: '?offset=', placeholder: '?offset={n}' },
      { pattern: '&offset=', placeholder: '&offset={n}' },
    ];
    let urlPattern: string | null = null;
    for (const { pattern, placeholder } of urlPatterns) {
      if (url.includes(pattern)) {
        urlPattern = placeholder;
        break;
      }
    }

    // Determine strategy and confidence
    const { bestCount, bestNext } = browserResult;

    let strategy = 'unknown';
    let confidence = 0.2;
    const details: Record<string, unknown> = {};
    const alternativesChecked: string[] = [];

    if (bestCount && bestCount.total) {
      strategy = 'count_based';
      confidence = 0.85;
      details.count_selector = bestCount.selector;
      details.count_text = bestCount.text;
      details.total_count = bestCount.total;
      details.products_per_page = bestCount.perPage;
      details.total_pages = bestCount.perPage ? Math.ceil(bestCount.total / bestCount.perPage) : null;
      details.url_pattern = urlPattern;
      details.next_button_selector = bestNext ? bestNext.selector : null;
      alternativesChecked.push('next_button', 'url_pattern');
    } else if (bestNext) {
      strategy = 'next_button';
      confidence = 0.7;
      details.next_button_selector = bestNext.selector;
      details.next_button_text = bestNext.text;
      details.next_button_href = bestNext.href;
      details.url_pattern = urlPattern;
      details.count_selector = null;
      alternativesChecked.push('count_based', 'url_pattern');
    } else if (urlPattern) {
      strategy = 'url_pattern';
      confidence = 0.5;
      details.url_pattern = urlPattern;
      details.next_button_selector = null;
      details.count_selector = null;
      alternativesChecked.push('count_based', 'next_button');
    } else {
      details.url_pattern = null;
      details.next_button_selector = null;
      details.count_selector = null;
      alternativesChecked.push('count_based', 'next_button', 'url_pattern');
    }

    const result = { strategy, confidence, details, alternatives_checked: alternativesChecked };

    return {
      code: [`// browser_detect_pagination`],
      captureSnapshot: false,
      waitForNetwork: false,
      resultOverride: {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      },
    };
  },
});

export default [countSelector, extractImages, detectPagination];
