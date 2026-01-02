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

// Function to get HTML from active browser tab and save it to a temporary file
async function getActiveTabHTML(context: any): Promise<string> {
  try {
    // Get the active tab and extract HTML content directly (same approach as html.ts)
    const tab = await context.ensureTab();
    const html = await tab.page.content();
    
    if (html && html.trim().length > 0) {
      // Create a temporary file to store the HTML content
      const tempFile = createTempHTMLFile(html);
      console.log(`Successfully extracted HTML from active tab (${html.length} characters)`);
      return tempFile;
    } else {
      throw new Error('Failed to get HTML content from active tab - content is empty');
    }
  } catch (error) {
    throw new Error(`Failed to get HTML from active tab: ${error}`);
  }
}

// Function to create a temporary HTML file
function createTempHTMLFile(htmlContent: string, url?: string): string {
  // Create a consistent temp directory for parser testing
  const tempDir = path.join(os.tmpdir(), 'playwright-mcp-parser-tester');
  
  // Ensure the directory exists
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  
  // Create a unique filename based on timestamp and URL (or just timestamp for auto-download)
  const timestamp = Date.now();
  const urlHash = url ? Buffer.from(url).toString('base64').replace(/[^a-zA-Z0-9]/g, '').substring(0, 8) : 'auto';
  const filename = `parser-test-${timestamp}-${urlHash}.html`;
  const filePath = path.join(tempDir, filename);
  
  // Write the HTML content to the file
  fs.writeFileSync(filePath, htmlContent, 'utf8');
  
  console.log(`Created temporary HTML file: ${filePath}`);
  return filePath;
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
    description: 'Test a DataHen parser using the Ruby parser_tester.rb script. Automatically downloads HTML from active browser tab if no HTML file is provided.',
    inputSchema: z.object({
      scraper_dir: z.string().describe('Absolute path to the scraper directory containing config.yaml (e.g., "D:\\DataHen\\projects\\playwright-mcp-mod\\scraping\\naivas_online")'),
      parser_path: z.string().describe('Path to the parser file relative to scraper directory (e.g., "parsers/details.rb")'),
      html_file: z.string().optional().describe('Absolute path to local HTML file to use for testing (optional - will use active browser tab if not provided)'),
      url: z.string().optional().describe('URL to test (only use after successful HTML file testing)'),
      vars: z.string().optional().describe('JSON string of variables to preload for testing'),
      page_type: z.string().optional().describe('Page type (details, listings, category, etc.)'),
      priority: z.number().optional().describe('Page priority (default: 500)'),
      job_id: z.number().optional().describe('Job ID (default: 12345)'),
      quiet: z.boolean().optional().describe('Suppress verbose output (recommended for AI contexts)'),
      auto_download: z.boolean().optional().describe('Automatically download HTML from active browser tab if no HTML file provided (default: true)'),
    }),
    type: 'readOnly',
  },

  handle: async (context, params) => {
    const {
      scraper_dir,
      parser_path,
      html_file,
      url,
      vars,
      page_type,
      priority,
      job_id,
      quiet = true,
      auto_download = true
    } = params;

    // Validate inputs
    if (!html_file && !url && !auto_download) {
      return {
        code: [`// Parser tester requires either HTML file, URL, or auto-download enabled`],
        captureSnapshot: false,
        waitForNetwork: false,
        resultOverride: {
          content: [{
            type: 'text',
            text: `❌ **ERROR**: Parser tester requires either:
1. An HTML file (--html parameter)
2. A URL (-u parameter) 
3. Auto-download enabled (--auto-download true, default)

**Current Parameters:**
- HTML file: ${html_file || 'Not provided'}
- URL: ${url || 'Not provided'}
- Auto-download: ${auto_download}

**Next Steps:**
- Provide an HTML file path, OR
- Provide a URL, OR
- Enable auto-download to use active browser tab content

**Example with auto-download:**
\`\`\`
parser_tester --scraper "D:\\DataHen\\projects\\playwright-mcp-mod\\scraping\\naivas_online" --parser "parsers/details.rb" --auto-download true
\`\`\``
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

    // Resolve HTML file path - either provided or auto-downloaded
    let resolvedHtmlFile = html_file;
    let tempHtmlFile: string | null = null;
    
         if (!html_file && auto_download) {
       try {
         // Auto-download HTML from active browser tab
         console.log('Auto-downloading HTML from active browser tab...');
         const tempHtmlPath = await getActiveTabHTML(context);
         
         if (!tempHtmlPath) {
           return {
             code: [`// Parser tester - failed to get HTML from active tab`],
             captureSnapshot: false,
             waitForNetwork: false,
             resultOverride: {
               content: [{
                 type: 'text',
                 text: `❌ **ERROR**: Failed to get HTML content from active browser tab.

**Possible Causes:**
- No active browser tab
- Browser not navigated to a page yet
- Page not fully loaded
- JavaScript execution failed

**Next Steps:**
1. **Navigate to a page first** using \`browser_navigate(url)\`
2. **Wait for page to load** using \`browser_wait_for\` if needed
3. **Ensure browser is active** and page is accessible
4. **Try again** with the parser tester

**Workflow:**
\`\`\`
# 1. Navigate to target page
browser_navigate("https://example.com/categories")

# 2. Wait for page to load (if needed)
browser_wait_for("text:Category Title")

# 3. Test parser with auto-download
parser_tester --scraper "D:\\DataHen\\projects\\playwright-mcp-mod\\scraping\\naivas_online" --parser "parsers/category.rb" --auto-download true
\`\`\`

**Alternative:** Provide an HTML file directly using \`--html\` parameter if auto-download continues to fail.`
               }]
             }
           };
         }
         
         // Use the temporary HTML file path returned by getActiveTabHTML
         tempHtmlFile = tempHtmlPath;
         resolvedHtmlFile = tempHtmlPath;
         
         console.log(`Successfully created temporary HTML file: ${tempHtmlPath}`);
         
       } catch (error: any) {
        return {
          code: [`// Parser tester - auto-download failed`],
          captureSnapshot: false,
          waitForNetwork: false,
          resultOverride: {
            content: [{
              type: 'text',
              text: `❌ **ERROR**: Auto-download failed: ${error.message}

**Possible Causes:**
- No active browser tab
- Browser not accessible
- MCP connection issues
- JavaScript execution failed

**Next Steps:**
1. **Verify browser is active** and has a loaded page
2. **Navigate to a page** using \`browser_navigate(url)\` if needed
3. **Check MCP connection** and browser state
4. **Use manual HTML file** with \`--html\` parameter as fallback

**Debug Information:**
- Error: ${error.message}
- Auto-download enabled: ${auto_download}
- HTML file provided: ${html_file || 'No'}

**Fallback Options:**
1. **Manual HTML download**: Use \`browser_download_page(filename)\` first
2. **Provide HTML file**: Use \`--html\` parameter with existing file
3. **Check browser state**: Ensure page is loaded and accessible`
            }]
          }
        };
      }
    }
    
    // If we still don't have an HTML file, check if the provided one exists
    if (resolvedHtmlFile && !tempHtmlFile) {
      resolvedHtmlFile = path.isAbsolute(resolvedHtmlFile) ? resolvedHtmlFile : path.resolve(process.cwd(), resolvedHtmlFile);
      
      // Check if HTML file exists
      if (!fs.existsSync(resolvedHtmlFile)) {
        return {
          code: [`// Parser tester - HTML file not found`],
          captureSnapshot: false,
          waitForNetwork: false,
          resultOverride: {
            content: [{
              type: 'text',
              text: `❌ **ERROR**: HTML file not found: \`${resolvedHtmlFile}\`

**Next Steps:**
- Download HTML pages using browser tools first:
  - \`browser_navigate(url)\` to visit target pages
  - \`browser_download_page(filename)\` to save HTML
  - Save to \`cache/\` directory for testing
- Ensure the HTML file path is correct
- Check if the file was downloaded successfully

**Debug Info:**
- Original HTML file path: \`${html_file}\`
- Resolved HTML file path: \`${resolvedHtmlFile}\`
- Current working directory: \`${process.cwd()}\`
- Path exists: \`${fs.existsSync(html_file || '')}\`
- Resolved path exists: \`${fs.existsSync(resolvedHtmlFile)}\`

**Recommended Workflow:**
\`\`\`
# 1. Download HTML using browser tools
browser_navigate("https://example.com/categories")
browser_download_page("category-page.html")

# 2. Test parser with downloaded HTML
parser_tester --scraper "D:\\DataHen\\projects\\playwright-mcp-mod\\scraping\\naivas_online" --parser "parsers/category.rb" --html "C:\\Users\\username\\Downloads\\category-page.html"
\`\`\`

**Or use auto-download:**
\`\`\`
# Navigate to page and test parser directly
browser_navigate("https://example.com/categories")
parser_tester --scraper "D:\\DataHen\\projects\\playwright-mcp-mod\\scraping\\naivas_online" --parser "parsers/category.rb" --auto-download true
\`\`\``
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

    // Build command string for display purposes
    const command = `ruby ${parserTesterPath} -s ${resolvedScraperDir} -p ${parser_path}${resolvedHtmlFile ? ` --html ${resolvedHtmlFile}` : ''}${url ? ` -u ${url}` : ''}${vars ? ` -v ${vars}` : ''}${page_type ? ` --page-type ${page_type}` : ''}${priority ? ` --priority ${priority}` : ''}${job_id ? ` --job-id ${job_id}` : ''}${quiet ? ' --quiet' : ''}`;

    try {
      // Execute the parser tester using spawn to capture exit code
      const result = await new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve, reject) => {
        const args = [
          parserTesterPath,
          '-s', resolvedScraperDir,
          '-p', parser_path,
          ...(resolvedHtmlFile ? ['--html', resolvedHtmlFile] : []),
          ...(url ? ['-u', url] : []),
          ...(vars ? ['-v', vars] : []),
          ...(page_type ? ['--page-type', page_type] : []),
          ...(priority ? ['--priority', priority.toString()] : []),
          ...(job_id ? ['--job-id', job_id.toString()] : []),
          ...(quiet ? ['--quiet'] : [])
        ];

        console.log('Executing parser_tester with args:', args);
        console.log('Working directory:', process.cwd());
        console.log('Parser tester path:', parserTesterPath);
        console.log('Original scraper dir:', scraper_dir);
        console.log('Resolved scraper dir:', resolvedScraperDir);
        console.log('Original HTML file:', html_file);
        console.log('Resolved HTML file:', resolvedHtmlFile);
        console.log('Auto-downloaded:', tempHtmlFile ? 'Yes' : 'No');

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
      if (tempHtmlFile) {
        cleanupTempFile(tempHtmlFile);
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

**HTML Source:** ${tempHtmlFile ? 'Auto-downloaded from active browser tab' : html_file ? 'Provided HTML file' : 'URL'}

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

**HTML Source:** ${tempHtmlFile ? 'Auto-downloaded from active browser tab' : html_file ? 'Provided HTML file' : 'URL'}

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
- HTML source: ${tempHtmlFile ? 'Auto-downloaded' : html_file ? 'Provided file' : 'URL'}`;
        
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
      // Clean up temporary file if we created one
      if (tempHtmlFile) {
        cleanupTempFile(tempHtmlFile);
      }

      let errorMessage = `❌ **Parser Test Failed**

**Command Attempted:**
\`\`\`bash
${command}
\`\`\`

**HTML Source:** ${tempHtmlFile ? 'Auto-downloaded from active browser tab' : html_file ? 'Provided HTML file' : 'URL'}

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
