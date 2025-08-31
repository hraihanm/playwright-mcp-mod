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

const parserTester = defineTool({
  capability: 'core',

  schema: {
    name: 'parser_tester',
    title: 'Test DataHen Parser',
    description: 'Test a DataHen parser using the Ruby parser_tester.rb script with HTML files or URLs',
    inputSchema: z.object({
      scraper_dir: z.string().describe('Absolute path to the scraper directory containing config.yaml (e.g., "D:\\DataHen\\projects\\playwright-mcp-mod\\scraping\\naivas_online")'),
      parser_path: z.string().describe('Path to the parser file relative to scraper directory (e.g., "parsers/details.rb")'),
      html_file: z.string().optional().describe('Absolute path to local HTML file to use for testing (recommended for initial testing)'),
      url: z.string().optional().describe('URL to test (only use after successful HTML file testing)'),
      vars: z.string().optional().describe('JSON string of variables to preload for testing'),
      page_type: z.string().optional().describe('Page type (details, listings, category, etc.)'),
      priority: z.number().optional().describe('Page priority (default: 500)'),
      job_id: z.number().optional().describe('Job ID (default: 12345)'),
      quiet: z.boolean().optional().describe('Suppress verbose output (recommended for AI contexts)'),
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
      quiet = true
    } = params;

    // Validate inputs
    if (!html_file && !url) {
      return {
        code: [`// Parser tester requires either HTML file or URL`],
        captureSnapshot: false,
        waitForNetwork: false,
        resultOverride: {
          content: [{
            type: 'text',
            text: `❌ **ERROR**: Parser tester requires either an HTML file (--html) or URL (-u) parameter.

**MANDATORY WORKFLOW** (as per GEMINI.md):
1. **ALWAYS** download HTML pages first using browser tools
2. **ALWAYS** test with downloaded HTML files using --html flag

**Next Steps:**
- Use \`browser_navigate(url)\` to visit target pages
- Use \`browser_download_page(filename)\` to save HTML for testing
- Save HTML to \`cache/\` directory
- Test parser with downloaded HTML using this tool with --html parameter

**Example:**
\`\`\`
# First download HTML using browser tools
browser_navigate("https://example.com/categories")
browser_download_page("category-page.html")

# Then test parser with downloaded HTML
parser_tester --scraper "D:\\DataHen\\projects\\playwright-mcp-mod\\scraping\\naivas_online" --parser "parsers/category.rb" --html "C:\\Users\\username\\Downloads\\category-page.html"
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
parser_tester --scraper "D:\\DataHen\\projects\\playwright-mcp-mod\\scraping\\naivas_online" --parser "parsers/details.rb" --html "C:\\Users\\username\\Downloads\\product.html"
\`\`\``
          }]
        }
      };
    }

    // Resolve HTML file path if specified
    let resolvedHtmlFile = html_file;
    if (html_file) {
      resolvedHtmlFile = path.isAbsolute(html_file) ? html_file : path.resolve(process.cwd(), html_file);
      
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
- Path exists: \`${fs.existsSync(html_file)}\`
- Resolved path exists: \`${fs.existsSync(resolvedHtmlFile)}\`

**Recommended Workflow:**
\`\`\`
# 1. Download HTML using browser tools
browser_navigate("https://example.com/categories")
browser_download_page("category-page.html")

# 2. Test parser with downloaded HTML
parser_tester --scraper "D:\\DataHen\\projects\\playwright-mcp-mod\\scraping\\naivas_online" --parser "parsers/category.rb" --html "C:\\Users\\username\\Downloads\\category-page.html"
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

      // Parse the output to provide helpful guidance
      let resultText = `✅ **Parser Test Completed Successfully**

**Command Executed:**
\`\`\`bash
${command}
\`\`\`

**Exit Code:** ${exitCode}

**Output:**
\`\`\`
${stdout.trim()}
\`\`\``;

      if (stderr.trim()) {
        resultText += `\n\n**Warnings/Errors:**
\`\`\`
${stderr.trim()}
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

**Ruby Error Output:**
\`\`\`
${stderr.trim() || 'No error output captured'}
\`\`\`

**Standard Output:**
\`\`\`
${stdout.trim() || 'No output captured'}
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
- Parser path: \`${parser_path}\``;
        
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
      if (stdout.includes('No outputs or pages generated')) {
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
      } else if (stdout.includes('Outputs') || stdout.includes('Pages')) {
        resultText += `\n\n🎯 **Parser is working correctly!**

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
      let errorMessage = `❌ **Parser Test Failed**

**Command Attempted:**
\`\`\`bash
${command}
\`\`\`

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
1. **Always test with HTML files**, do not using live URLs
2. **Use browser tools** to verify HTML structure and selectors
3. **Check parser syntax** with Ruby interpreter
4. **Verify file paths** are correct relative to current directory
5. **Ensure scraper directory** contains valid DataHen configuration`;

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
