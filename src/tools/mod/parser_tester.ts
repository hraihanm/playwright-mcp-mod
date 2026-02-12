/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the file except in compliance with the License.
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
import os from 'os';

// Get current directory path for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Function to find parser_tester.rb in multiple possible locations
function findParserTester(): string | null {
  const possiblePaths = [
    // Current working directory
    'parser_tester.rb',
    // Scraping subdirectory
    'scraping/parser_tester.rb',
    // Package root
    path.join(process.cwd(), 'scraping', 'parser_tester.rb'),
    // Relative to scraper directory (if provided)
    path.join(process.cwd(), 'scraping', 'parser_tester.rb'),
    // Try to find in node_modules or package
    path.join(process.cwd(), 'node_modules', 'playwright-mcp-mod', 'scraping', 'parser_tester.rb'),
    // Try to find in the package directory
    path.join(__dirname, '..', '..', '..', 'scraping', 'parser_tester.rb'),
    // Additional paths for better compatibility
    path.join(process.cwd(), '..', 'scraping', 'parser_tester.rb'),
    path.join(process.cwd(), '..', '..', 'scraping', 'parser_tester.rb'),
    // Try to find from the current file's location
    path.join(__dirname, '..', '..', 'scraping', 'parser_tester.rb'),
    path.join(__dirname, '..', '..', '..', 'scraping', 'parser_tester.rb'),
    path.join(__dirname, '..', '..', '..', '..', 'scraping', 'parser_tester.rb'),
    // Try to find in installed package location
    path.join(__dirname, '..', '..', '..', '..', '..', 'scraping', 'parser_tester.rb'),
    path.join(__dirname, '..', '..', '..', '..', '..', '..', 'scraping', 'parser_tester.rb'),
  ];

  for (const testPath of possiblePaths) {
    if (fs.existsSync(testPath)) {
      console.log(`Found parser_tester.rb at: ${testPath}`);
      return testPath;
    }
  }

  // If not found, try to search more broadly
  try {
    const searchPaths = [
      process.cwd(),
      path.join(process.cwd(), 'scraping'),
      path.join(process.cwd(), '..'),
      path.join(process.cwd(), '..', 'scraping'),
      __dirname,
      path.join(__dirname, '..'),
      path.join(__dirname, '..', '..'),
      path.join(__dirname, '..', '..', 'scraping'),
      // Also search in node_modules for installed packages
      path.join(process.cwd(), 'node_modules'),
      path.join(process.cwd(), '..', 'node_modules'),
      path.join(process.cwd(), '..', '..', 'node_modules'),
    ];

    for (const searchPath of searchPaths) {
      if (fs.existsSync(searchPath)) {
        try {
          const files = fs.readdirSync(searchPath);
          if (files.includes('parser_tester.rb')) {
            const foundPath = path.join(searchPath, 'parser_tester.rb');
            console.log(`Found parser_tester.rb at: ${foundPath}`);
            return foundPath;
          }
          // Also check if there's a scraping subdirectory
          if (files.includes('scraping')) {
            const scrapingPath = path.join(searchPath, 'scraping');
            const scrapingFiles = fs.readdirSync(scrapingPath);
            if (scrapingFiles.includes('parser_tester.rb')) {
              const foundPath = path.join(scrapingPath, 'parser_tester.rb');
              console.log(`Found parser_tester.rb at: ${foundPath}`);
              return foundPath;
            }
          }
        } catch (error) {
          // Skip directories we can't read
          continue;
        }
      }
    }
  } catch (error) {
    console.error('Error searching for parser_tester.rb:', error);
  }

  console.log('parser_tester.rb not found in any location');
  return null;
}

// Function to get content from active browser tab and save it to a temporary file
// Supports either page HTML or network response matching a URL pattern
async function getActiveTabContent(context: any, urlPattern?: string): Promise<{filePath: string, contentType: string}> {
  if (urlPattern) {
    // Search captured network responses for matching URL
    const tab = context.currentTabOrDie();
    const requests = tab.requests();

    for (const [request, response] of requests.entries()) {
      if (request.url().includes(urlPattern) && response) {
        try {
          const ct = response.headers()['content-type'] || '';
          // Skip binary responses
          if (/^(image|audio|video)\//i.test(ct))
            continue;
          const body = await response.text();
          if (body && body.length > 0) {
            const ext = extensionFromContentType(ct);
            const filePath = createTempContentFile(body, ext);
            const contentTypeShort = ct.includes('json') ? 'json' : ct.includes('xml') ? 'xml' : 'html';
            console.log(`Downloaded network response (${body.length} chars, ${contentTypeShort}) for pattern "${urlPattern}"`);
            return { filePath, contentType: contentTypeShort };
          }
        } catch {
          // Skip responses we can't read
          continue;
        }
      }
    }
    throw new Error(`No captured network response matching "${urlPattern}". Navigate to the page first and ensure the API call is captured.`);
  } else {
    // Existing behavior: get page HTML
    try {
      const tab = await context.ensureTab();
      const html = await tab.page.content();

      if (html && html.trim().length > 0) {
        const filePath = createTempContentFile(html, '.html');
        console.log(`Successfully extracted HTML from active tab (${html.length} characters)`);
        return { filePath, contentType: 'html' };
      } else {
        throw new Error('Failed to get HTML content from active tab - content is empty');
      }
    } catch (error) {
      throw new Error(`Failed to get content from active tab: ${error}`);
    }
  }
}

// Function to create a temporary content file (HTML, JSON, or XML)
function createTempContentFile(content: string, extension: string = '.html', url?: string): string {
  // Create a consistent temp directory for parser testing
  const tempDir = path.join(os.tmpdir(), 'playwright-mcp-parser-tester');

  // Ensure the directory exists
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  // Create a unique filename based on timestamp and URL (or just timestamp for auto-download)
  const timestamp = Date.now();
  const urlHash = url ? Buffer.from(url).toString('base64').replace(/[^a-zA-Z0-9]/g, '').substring(0, 8) : 'auto';
  const filename = `parser-test-${timestamp}-${urlHash}${extension}`;
  const filePath = path.join(tempDir, filename);

  // Write the content to the file
  fs.writeFileSync(filePath, content, 'utf8');

  console.log(`Created temporary content file: ${filePath}`);
  return filePath;
}

// Determine file extension from content type string
function extensionFromContentType(contentType: string): string {
  if (contentType.includes('json')) return '.json';
  if (contentType.includes('xml')) return '.xml';
  return '.html';
}

// Determine content type string from file path extension
function contentTypeFromExtension(filePath: string): string | undefined {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.json': return 'json';
    case '.xml': return 'xml';
    case '.html': case '.htm': return 'html';
    default: return undefined;
  }
}

// Function to cleanup temporary files (optional)
function cleanupTempFile(filePath: string) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`Cleaned up temporary file: ${filePath}`);
    }
  } catch (error) {
    console.warn(`Failed to cleanup temporary file ${filePath}:`, error);
  }
}

const parserTester = defineTool({
  capability: 'core',

  schema: {
    name: 'parser_tester',
    title: 'Test DataHen Parser',
    description: 'Test a DataHen parser using the Ruby parser_tester.rb script. Supports HTML, JSON, and XML content. Automatically downloads content from active browser tab if no content file is provided.',
    inputSchema: z.object({
      scraper_dir: z.string().describe('Absolute path to the scraper directory containing config.yaml (e.g., "D:\\DataHen\\projects\\playwright-mcp-mod\\scraping\\naivas_online")'),
      parser_path: z.string().describe('Path to the parser file relative to scraper directory (e.g., "parsers/details.rb")'),
      html_file: z.string().optional().describe('Absolute path to local HTML file to use for testing (optional - will use active browser tab if not provided)'),
      content_file: z.string().optional().describe('Absolute path to content file (JSON, XML, or HTML). Auto-detects type from extension. Alias for html_file with content-type awareness.'),
      content_type: z.string().optional().describe('Content type override: "json", "xml", or "html". Auto-detected from file extension if not provided.'),
      auto_download_url: z.string().optional().describe('URL pattern to match when auto-downloading from network responses (instead of page HTML). Downloads the response body of the first matching captured request.'),
      url: z.string().optional().describe('URL to test (only use after successful HTML file testing)'),
      vars: z.string().optional().describe('JSON string of variables to preload for testing'),
      page_type: z.string().optional().describe('Page type (details, listings, category, etc.)'),
      priority: z.number().optional().describe('Page priority (default: 500)'),
      job_id: z.number().optional().describe('Job ID (default: 12345)'),
      quiet: z.boolean().optional().describe('Suppress verbose output (recommended for AI contexts)'),
      auto_download: z.boolean().optional().describe('Automatically download content from active browser tab if no content file provided (default: true)'),
      verify_pages: z.boolean().optional().default(false).describe('After parser test, fetch a sample of generated page URLs to verify forged API requests work. Uses browser context (inherits cookies/session).'),
      verify_sample_size: z.number().optional().default(3).describe('Number of pages to sample for verification when verify_pages is true. Default: 3.'),
    }),
    type: 'readOnly',
  },

  handle: async (context, params) => {
    const {
      scraper_dir,
      parser_path,
      html_file,
      content_file,
      content_type,
      auto_download_url,
      url,
      vars,
      page_type,
      priority,
      job_id,
      quiet = true,
      auto_download = true,
      verify_pages = false,
      verify_sample_size = 3,
    } = params;

    // content_file takes precedence over html_file
    const effectiveContentFile = content_file || html_file;

    // Validate inputs
    if (!effectiveContentFile && !url && !auto_download) {
      return {
        code: [`// Parser tester requires either content file, URL, or auto-download enabled`],
        captureSnapshot: false,
        waitForNetwork: false,
        resultOverride: {
          content: [{
            type: 'text',
            text: `**ERROR**: Parser tester requires either:
1. A content file (content_file or html_file parameter)
2. A URL (-u parameter)
3. Auto-download enabled (auto_download: true, default)

**Current Parameters:**
- Content file: ${effectiveContentFile || 'Not provided'}
- URL: ${url || 'Not provided'}
- Auto-download: ${auto_download}

**Next Steps:**
- Provide a content file path (HTML, JSON, or XML), OR
- Provide a URL, OR
- Enable auto-download to use active browser tab content`
          }]
        }
      };
    }

    // Since we expect absolute paths, use them directly
    const resolvedScraperDir = scraper_dir;
    
    // Debug logging
    console.log('Path resolution debug:');
    console.log('  Original scraper_dir:', scraper_dir);
    console.log('  process.cwd():', process.cwd());
    console.log('  __dirname:', __dirname);
    console.log('  Resolved scraper dir:', resolvedScraperDir);
    console.log('  Path exists check:', fs.existsSync(scraper_dir));
    console.log('  Resolved path exists check:', fs.existsSync(resolvedScraperDir));
    
    // Check if scraper directory exists
    if (!fs.existsSync(resolvedScraperDir)) {
      return {
        code: [`// Parser tester - scraper directory not found`],
        captureSnapshot: false,
        waitForNetwork: false,
        resultOverride: {
          content: [{
            type: 'text',
            text: `❌ **ERROR**: Scraper directory not found: \`${resolvedScraperDir}\`

**Next Steps:**
- Verify the scraper directory path is correct
- Ensure the directory contains a \`config.yaml\` file
- Check if the scraper has been generated yet

**Common Issues:**
- Path should be an absolute path (e.g., "D:\\DataHen\\projects\\playwright-mcp-mod\\scraping\\naivas_online")
- Scraper hasn't been created yet
- Directory name mismatch

**Debug Info:**
- Original path: \`${scraper_dir}\`
- Resolved path: \`${resolvedScraperDir}\`
- Current working directory: \`${process.cwd()}\`
- Path exists: \`${fs.existsSync(scraper_dir)}\`
- Resolved path exists: \`${fs.existsSync(resolvedScraperDir)}\``
          }]
        }
      };
    }

    // Check if config.yaml exists in scraper directory
    const configPath = path.join(resolvedScraperDir, 'config.yaml');
    if (!fs.existsSync(configPath)) {
      return {
        code: [`// Parser tester - config.yaml not found`],
        captureSnapshot: false,
        waitForNetwork: false,
        resultOverride: {
          content: [{
            type: 'text',
            text: `❌ **ERROR**: \`config.yaml\` not found in scraper directory: \`${configPath}\`

**Next Steps:**
- Ensure the scraper directory contains a valid DataHen configuration
- Check if the scraper has been properly initialized
- Verify the directory structure is correct

**Expected Structure:**
\`\`\`
${resolvedScraperDir}/
├── config.yaml
├── parsers/
│   ├── category.rb
│   ├── listings.rb
│   └── details.rb
└── lib/
\`\`\``
          }]
        }
      };
    }

    // Check if parser file exists
    const fullParserPath = path.join(resolvedScraperDir, parser_path);
    if (!fs.existsSync(fullParserPath)) {
      return {
        code: [`// Parser tester - parser file not found`],
        captureSnapshot: false,
        waitForNetwork: false,
        resultOverride: {
          content: [{
            type: 'text',
            text: `❌ **ERROR**: Parser file not found: \`${fullParserPath}\`

**Next Steps:**
- Verify the parser path is correct relative to scraper directory
- Ensure the parser file exists in the specified location
- Check if the parser has been generated yet

**Common Parser Paths:**
- \`parsers/category.rb\` - for category parsing
- \`parsers/listings.rb\` - for product listings
- \`parsers/details.rb\` - for product details

**Example:**
\`\`\`
parser_tester --scraper "D:\\DataHen\\projects\\playwright-mcp-mod\\scraping\\naivas_online" --parser "parsers/details.rb" --auto-download true
\`\`\``
          }]
        }
      };
    }

    // Resolve content file path - either provided or auto-downloaded
    let resolvedContentFile = effectiveContentFile;
    let tempContentFile: string | null = null;
    let detectedContentType: string | undefined = content_type;

    if (!effectiveContentFile && auto_download) {
      try {
        // Auto-download content from active browser tab (or network response)
        console.log(auto_download_url
          ? `Auto-downloading network response matching "${auto_download_url}"...`
          : 'Auto-downloading HTML from active browser tab...');
        const result = await getActiveTabContent(context, auto_download_url);

        if (!result.filePath) {
          return {
            code: [`// Parser tester - failed to get content from active tab`],
            captureSnapshot: false,
            waitForNetwork: false,
            resultOverride: {
              content: [{
                type: 'text',
                text: `**ERROR**: Failed to get content from active browser tab.

**Next Steps:**
1. Navigate to a page first using \`browser_navigate(url)\`
2. Wait for page to load using \`browser_wait_for\` if needed
3. Ensure browser is active and page is accessible
4. Try again with the parser tester`
              }]
            }
          };
        }

        tempContentFile = result.filePath;
        resolvedContentFile = result.filePath;
        if (!detectedContentType)
          detectedContentType = result.contentType;

        console.log(`Successfully created temporary content file: ${result.filePath} (type: ${result.contentType})`);

      } catch (error: any) {
        return {
          code: [`// Parser tester - auto-download failed`],
          captureSnapshot: false,
          waitForNetwork: false,
          resultOverride: {
            content: [{
              type: 'text',
              text: `**ERROR**: Auto-download failed: ${error.message}

**Next Steps:**
1. Verify browser is active and has a loaded page
2. Navigate to a page using \`browser_navigate(url)\` if needed
3. If using auto_download_url, ensure the API call is captured (use browser_network_search first)
4. Use manual content file with \`content_file\` or \`html_file\` parameter as fallback`
            }]
          }
        };
      }
    }
    
    // If we still don't have a content file, check if the provided one exists
    if (resolvedContentFile && !tempContentFile) {
      resolvedContentFile = path.isAbsolute(resolvedContentFile) ? resolvedContentFile : path.resolve(process.cwd(), resolvedContentFile);

      // Auto-detect content type from file extension if not explicitly set
      if (!detectedContentType)
        detectedContentType = contentTypeFromExtension(resolvedContentFile);

      // Check if content file exists
      if (!fs.existsSync(resolvedContentFile)) {
        return {
          code: [`// Parser tester - content file not found`],
          captureSnapshot: false,
          waitForNetwork: false,
          resultOverride: {
            content: [{
              type: 'text',
              text: `**ERROR**: Content file not found: \`${resolvedContentFile}\`

**Next Steps:**
- For HTML: Use browser_navigate then auto_download, or provide a downloaded HTML file
- For JSON/XML: Use browser_network_download to save an API response, then pass it as content_file
- Ensure the file path is correct`
            }]
          }
        };
      }
    }

    // Find parser_tester.rb
    const parserTesterPath = findParserTester();
    if (!parserTesterPath) {
      return {
        code: [`// Parser tester - parser_tester.rb not found`],
        captureSnapshot: false,
        waitForNetwork: false,
        resultOverride: {
          content: [{
            type: 'text',
            text: `❌ **ERROR**: \`parser_tester.rb\` not found in any of the expected locations.

**Searched Locations:**
- Current working directory: \`${process.cwd()}\`
- Scraping subdirectory: \`${path.join(process.cwd(), 'scraping')}\`
- Package root: \`${path.join(process.cwd(), 'scraping')}\`
- Node modules: \`${path.join(process.cwd(), 'node_modules', 'playwright-mcp-mod', 'scraping')}\`
- Package directory: \`${path.join(__dirname, '..', '..', '..', 'scraping')}\`

**Next Steps:**
- Ensure \`parser_tester.rb\` is available in the project
- Check if the file exists in the scraping directory
- Verify the package installation is complete
- Try running from the project root directory

**Expected Location:** \`scraping/parser_tester.rb\`

**Debug Information:**
- Current working directory: \`${process.cwd()}\`
- __dirname: \`${__dirname}\`
- File exists check: \`${fs.existsSync('scraping/parser_tester.rb')}\`
- Scraping dir exists: \`${fs.existsSync('scraping')}\`

**Installation Issues:**
This error typically occurs when:
1. **Development Environment**: You're running from source but the scraping directory is missing
2. **Package Installation**: The npm package doesn't include the scraping directory
3. **File Permissions**: The file exists but can't be accessed

**Solutions:**
1. **For Development**: Ensure you have the complete source code including the \`scraping/\` directory
2. **For Package Users**: The scraping directory should be included in the npm package. If not, this is a packaging issue.
3. **Manual Download**: You can manually download \`parser_tester.rb\` from the project repository and place it in a \`scraping/\` directory

**File Requirements:**
The \`parser_tester.rb\` script requires:
- Ruby interpreter (\`ruby --version\`)
- Nokogiri gem (\`gem install nokogiri\`)
- Standard Ruby libraries (net/http, json, etc.)

**Temporary Workaround:**
If you have access to the source repository, you can:
1. Clone the repository: \`git clone <repo-url>\`
2. Navigate to the scraping directory: \`cd scraping\`
3. Run the parser tester directly: \`ruby parser_tester.rb -s <scraper_dir> -p <parser_path> --html <html_file>\``
          }]
        }
      };
    }

    // Create temp file for --dump-pages when verify_pages is enabled
    const dumpPagesFile = verify_pages
      ? path.join(os.tmpdir(), `parser-pages-dump-${Date.now()}.json`)
      : null;

    // Build command string for display purposes
    const command = `ruby ${parserTesterPath} -s ${resolvedScraperDir} -p ${parser_path}${resolvedContentFile ? ` --html ${resolvedContentFile}` : ''}${detectedContentType ? ` --content-type ${detectedContentType}` : ''}${url ? ` -u ${url}` : ''}${vars ? ` -v ${vars}` : ''}${page_type ? ` --page-type ${page_type}` : ''}${priority ? ` --priority ${priority}` : ''}${job_id ? ` --job-id ${job_id}` : ''}${quiet ? ' --quiet' : ''}${dumpPagesFile ? ` --dump-pages ${dumpPagesFile}` : ''}`;

    try {
      // Execute the parser tester using spawn to capture exit code
      const result = await new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve, reject) => {
        const args = [
          parserTesterPath,
          '-s', resolvedScraperDir,
          '-p', parser_path,
          ...(resolvedContentFile ? ['--html', resolvedContentFile] : []),
          ...(detectedContentType ? ['--content-type', detectedContentType] : []),
          ...(url ? ['-u', url] : []),
          ...(vars ? ['-v', vars] : []),
          ...(page_type ? ['--page-type', page_type] : []),
          ...(priority ? ['--priority', priority.toString()] : []),
          ...(job_id ? ['--job-id', job_id.toString()] : []),
          ...(quiet ? ['--quiet'] : []),
          ...(dumpPagesFile ? ['--dump-pages', dumpPagesFile] : [])
        ];

        console.log('Executing parser_tester with args:', args);
        console.log('Working directory:', process.cwd());
        console.log('Parser tester path:', parserTesterPath);
        console.log('Original scraper dir:', scraper_dir);
        console.log('Resolved scraper dir:', resolvedScraperDir);
        console.log('Original content file:', effectiveContentFile);
        console.log('Resolved content file:', resolvedContentFile);
        console.log('Content type:', detectedContentType || 'auto');
        console.log('Auto-downloaded:', tempContentFile ? 'Yes' : 'No');

        const child = spawn('ruby', args, {
          cwd: process.cwd(),
          stdio: ['pipe', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';

        child.stdout?.on('data', (data) => {
          stdout += data.toString();
        });

        child.stderr?.on('data', (data) => {
          stderr += data.toString();
        });

        child.on('close', (code) => {
          resolve({
            stdout,
            stderr,
            exitCode: code ?? -1
          });
        });

        child.on('error', (error) => {
          console.error('Child process error:', error);
          reject(error);
        });

        // Set timeout
        setTimeout(() => {
          child.kill();
          reject(new Error('Execution timeout after 60 seconds'));
        }, 60000);
      });

      const { stdout, stderr, exitCode } = result;

      // Clean up temporary file if we created one
      if (tempContentFile) {
        cleanupTempFile(tempContentFile);
      }

      // Normalize line endings (convert \r\n to \n for consistent display)
      const normalizeOutput = (text: string): string => {
        return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
      };

      const normalizedStdout = normalizeOutput(stdout);
      const normalizedStderr = normalizeOutput(stderr);

      // Parse the output to provide helpful guidance
      let resultText = `✅ **Parser Test Completed Successfully**

**Command Executed:**
\`\`\`bash
${command}
\`\`\`

**Exit Code:** ${exitCode}

**Content Source:** ${tempContentFile ? (auto_download_url ? 'Auto-downloaded from network response' : 'Auto-downloaded from active browser tab') : effectiveContentFile ? 'Provided content file' : 'URL'}${detectedContentType ? ` (${detectedContentType})` : ''}

**Output:**
\`\`\`
${normalizedStdout}
\`\`\``;

      if (normalizedStderr) {
        resultText += `\n\n**Warnings/Errors:**
\`\`\`
${normalizedStderr}
\`\`\``;
      }

      // Check exit code first
      if (exitCode !== 0) {
        resultText = `❌ **Parser Test Failed with Exit Code ${exitCode}**

**Command Executed:**
\`\`\`bash
${command}
\`\`\`

**Exit Code:** ${exitCode}

**Content Source:** ${tempContentFile ? (auto_download_url ? 'Auto-downloaded from network response' : 'Auto-downloaded from active browser tab') : effectiveContentFile ? 'Provided content file' : 'URL'}${detectedContentType ? ` (${detectedContentType})` : ''}

**Ruby Error Output:**
\`\`\`
${normalizedStderr || 'No error output captured'}
\`\`\`

**Standard Output:**
\`\`\`
${normalizedStdout || 'No output captured'}
\`\`\`

**Exit Code ${exitCode} typically indicates:**
- **1-127**: Ruby execution errors (syntax errors, runtime errors, missing gems)
- **128+**: System-level errors (file not found, permission denied, etc.)

**Next Steps:**
1. **Check Ruby syntax**: \`ruby -c ${parser_path}\`
2. **Verify dependencies**: Ensure all required gems are installed
3. **Review error output**: Look for specific error messages in stderr
4. **Check file permissions**: Ensure parser files are readable
5. **Test with simpler HTML**: Use a minimal HTML file to isolate issues

**Debug Information:**
- Parser tester path: \`${parserTesterPath}\`
- Working directory: \`${process.cwd()}\`
- Original scraper directory: \`${scraper_dir}\`
- Resolved scraper directory: \`${resolvedScraperDir}\`
- Parser path: \`${parser_path}\`
- Content source: ${tempContentFile ? 'Auto-downloaded' : effectiveContentFile ? 'Provided file' : 'URL'}`;
        
        return {
          code: [`// Parser tester failed with exit code ${exitCode}: ${command}`],
          captureSnapshot: false,
          waitForNetwork: false,
          resultOverride: {
            content: [{
              type: 'text',
              text: resultText
            }]
          }
        };
      }

      // Analyze output to provide next steps
      if (normalizedStdout.includes('No outputs or pages generated')) {
        resultText += `\n\n⚠️ **WARNING**: Parser generated no outputs or pages.

**Possible Issues:**
- Selectors may not be matching the HTML content
- Parser logic may have errors
- HTML structure may be different than expected

**Next Steps:**
1. Review the HTML content to verify structure
2. Check if selectors in the parser match the actual HTML
3. Use browser tools to inspect elements and verify selectors
4. Test with different HTML pages to ensure consistency`;
      } else if (normalizedStdout.includes('Outputs') || normalizedStdout.includes('Pages')) {
        // Extract counts for summary
        const outputsMatch = normalizedStdout.match(/Outputs \((\d+)\)/);
        const pagesMatch = normalizedStdout.match(/Pages \((\d+)\)/);
        
        let summary = '';
        if (outputsMatch) {
          summary += `- **${outputsMatch[1]} outputs** generated\n`;
        }
        if (pagesMatch) {
          summary += `- **${pagesMatch[1]} pages** generated\n`;
        }
        
        resultText += `\n\n🎯 **Parser is working correctly!**

**Summary:**
${summary}
**Next Steps:**
1. **Test with multiple HTML files** to ensure consistency across different pages
2. **Verify data quality** by checking extracted fields
3. **Test variable passing** between parsers if applicable
`;
      }

      // === Page Verification ===
      if (verify_pages && dumpPagesFile && exitCode === 0) {
        try {
          if (fs.existsSync(dumpPagesFile)) {
            const dumpContent = fs.readFileSync(dumpPagesFile, 'utf8');
            const allPages: any[] = JSON.parse(dumpContent);

            if (allPages.length > 0) {
              // Evenly spaced sampling
              const sampleSize = Math.min(verify_sample_size, allPages.length);
              const sampledPages: any[] = [];
              if (sampleSize === 1) {
                sampledPages.push(allPages[0]);
              } else {
                for (let i = 0; i < sampleSize; i++) {
                  const idx = Math.round(i * (allPages.length - 1) / (sampleSize - 1));
                  sampledPages.push(allPages[idx]);
                }
              }

              resultText += `\n\n## Page Verification (${sampleSize} of ${allPages.length} pages sampled)\n`;

              let passed = 0;
              const tab = context.currentTabOrDie();

              for (const pg of sampledPages) {
                const fetchUrl = pg.url;
                const fetchMethod = (pg.method || 'GET').toUpperCase();
                const fetchHeaders: Record<string, string> = pg.headers || {};
                if (pg.cookie && !fetchHeaders['Cookie']) {
                  fetchHeaders['Cookie'] = pg.cookie;
                }
                const fetchBody = pg.body || undefined;

                try {
                  const fetchResult = await tab.page.evaluate(
                    async ({ url, method, headers, body }: { url: string; method: string; headers: Record<string, string>; body?: string }) => {
                      const opts: RequestInit = { method, headers };
                      if (body && method !== 'GET')
                        opts.body = body;
                      const resp = await fetch(url, opts);
                      const text = await resp.text();
                      return { status: resp.status, statusText: resp.statusText, length: text.length };
                    },
                    { url: fetchUrl, method: fetchMethod, headers: fetchHeaders, body: fetchBody }
                  );

                  const ok = fetchResult.status >= 200 && fetchResult.status < 400;
                  if (ok) passed++;
                  const icon = ok ? '\u2705' : '\u274C';
                  resultText += `${icon} [${fetchMethod}] ${fetchUrl} => ${fetchResult.status} ${fetchResult.statusText} (${fetchResult.length} chars)\n`;
                } catch (fetchErr: any) {
                  resultText += `\u274C [${fetchMethod}] ${fetchUrl} => FETCH ERROR: ${fetchErr.message}\n`;
                }
              }

              resultText += `\nResult: ${passed}/${sampleSize} passed`;
            }

            // Clean up dump file
            cleanupTempFile(dumpPagesFile);
          }
        } catch (verifyErr: any) {
          resultText += `\n\n## Page Verification\n\u274C Verification failed: ${verifyErr.message}`;
          if (dumpPagesFile) cleanupTempFile(dumpPagesFile);
        }
      } else if (dumpPagesFile) {
        // Clean up dump file even if verify wasn't performed (e.g. non-zero exit)
        cleanupTempFile(dumpPagesFile);
      }

      return {
        code: [`// Parser tester executed: ${command}`],
        captureSnapshot: false,
        waitForNetwork: false,
        resultOverride: {
          content: [{
            type: 'text',
            text: resultText
          }]
        }
      };

    } catch (error: any) {
      // Clean up temporary files if we created them
      if (tempContentFile) {
        cleanupTempFile(tempContentFile);
      }
      if (dumpPagesFile) {
        cleanupTempFile(dumpPagesFile);
      }

      let errorMessage = `❌ **Parser Test Failed**

**Command Attempted:**
\`\`\`bash
${command}
\`\`\`

**Content Source:** ${tempContentFile ? (auto_download_url ? 'Auto-downloaded from network response' : 'Auto-downloaded from active browser tab') : effectiveContentFile ? 'Provided content file' : 'URL'}${detectedContentType ? ` (${detectedContentType})` : ''}

**Error:**
\`\`\`
${error.message}
\`\`\``;

      // Provide specific guidance based on error type
      if (error.message.includes('ENOENT')) {
        errorMessage += `\n\n🔍 **File Not Found Error**

**Possible Causes:**
- Ruby interpreter not found in PATH
- parser_tester.rb script not found
- Incorrect file paths

**Next Steps:**
1. Verify Ruby is installed: \`ruby --version\`
2. Check if parser_tester.rb exists in scraping/ directory
3. Verify all file paths are correct
4. Ensure you're running from the project root directory`;
      } else if (error.message.includes('timeout')) {
        errorMessage += `\n\n⏰ **Execution Timeout**

**Possible Causes:**
- Network request hanging
- Parser logic issues

**Next Steps:**
1. Check parser logic for infinite loops
2. Verify HTML file size and complexity
3. Test with smaller HTML files first
4. Review parser code for performance issues`;
      } else if (error.message.includes('ruby')) {
        errorMessage += `\n\n💎 **Ruby Execution Error**

**Possible Causes:**
- Syntax errors in parser file
- Runtime errors in parser execution
- Missing dependencies or gems

**Next Steps:**
1. Check parser file syntax: \`ruby -c parsers/your_parser.rb\`
2. Verify all required gems are installed
3. Check Ruby version compatibility
4. Review parser code for syntax errors
5. Check the exit code for specific error information`;
      }

      errorMessage += `\n\n**Troubleshooting Tips:**
1. **Use auto-download** (default) to get HTML from active browser tab
2. **Navigate to page first** using \`browser_navigate(url)\`
3. **Check parser syntax** with Ruby interpreter
4. **Verify file paths** are correct relative to current directory
5. **Ensure scraper directory** contains valid DataHen configuration

**Auto-Download Workflow:**
\`\`\`
# 1. Navigate to target page
browser_navigate("https://example.com/categories")

# 2. Test parser directly (auto-downloads HTML)
parser_tester --scraper "D:\\DataHen\\projects\\playwright-mcp-mod\\scraping\\naivas_online" --parser "parsers/category.rb" --auto-download true
\`\`\``;

      return {
        code: [`// Parser tester failed: ${command}`],
        captureSnapshot: false,
        waitForNetwork: false,
        resultOverride: {
          content: [{
            type: 'text',
            text: errorMessage
          }]
        }
      };
    }
  },
});

export default [
  parserTester,
];
