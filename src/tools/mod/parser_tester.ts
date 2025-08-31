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

const parserTester = defineTool({
  capability: 'core',

  schema: {
    name: 'parser_tester',
    title: 'Test DataHen Parser',
    description: 'Test a DataHen parser using the Ruby parser_tester.rb script with HTML files or URLs',
    inputSchema: z.object({
      scraper_dir: z.string().describe('Path to the scraper directory containing config.yaml'),
      parser_path: z.string().describe('Path to the parser file relative to scraper directory (e.g., "parsers/details.rb")'),
      html_file: z.string().optional().describe('Path to local HTML file to use for testing (recommended for initial testing)'),
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
3. **ONLY** use live URLs after successful HTML file testing

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
parser_tester --scraper "./generated_scraper" --parser "parsers/category.rb" --html "./cache/category-page.html"
\`\`\``
          }]
        }
      };
    }

    // Check if scraper directory exists
    if (!fs.existsSync(scraper_dir)) {
      return {
        code: [`// Parser tester - scraper directory not found`],
        captureSnapshot: false,
        waitForNetwork: false,
        resultOverride: {
          content: [{
            type: 'text',
            text: `❌ **ERROR**: Scraper directory not found: \`${scraper_dir}\`

**Next Steps:**
- Verify the scraper directory path is correct
- Ensure the directory contains a \`config.yaml\` file
- Check if the scraper has been generated yet

**Common Issues:**
- Path is relative to current working directory
- Scraper hasn't been created yet
- Directory name mismatch`
          }]
        }
      };
    }

    // Check if config.yaml exists in scraper directory
    const configPath = path.join(scraper_dir, 'config.yaml');
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
${scraper_dir}/
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
    const fullParserPath = path.join(scraper_dir, parser_path);
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
parser_tester --scraper "./generated_scraper" --parser "parsers/details.rb" --html "./cache/product.html"
\`\`\``
          }]
        }
      };
    }

    // If HTML file is specified, check if it exists
    if (html_file && !fs.existsSync(html_file)) {
      return {
        code: [`// Parser tester - HTML file not found`],
        captureSnapshot: false,
        waitForNetwork: false,
        resultOverride: {
          content: [{
            type: 'text',
            text: `❌ **ERROR**: HTML file not found: \`${html_file}\`

**Next Steps:**
- Download HTML pages using browser tools first:
  - \`browser_navigate(url)\` to visit target pages
  - \`browser_download_page(filename)\` to save HTML
  - Save to \`cache/\` directory for testing
- Ensure the HTML file path is correct
- Check if the file was downloaded successfully

**Recommended Workflow:**
\`\`\`
# 1. Download HTML using browser tools
browser_navigate("https://example.com/categories")
browser_download_page("category-page.html")

# 2. Test parser with downloaded HTML
parser_tester --scraper "./generated_scraper" --parser "parsers/category.rb" --html "./cache/category-page.html"
\`\`\``
          }]
        }
      };
    }

    // Build command string for display purposes
    const command = `ruby scraping/parser_tester.rb -s ${scraper_dir} -p ${parser_path}${html_file ? ` --html ${html_file}` : ''}${url ? ` -u ${url}` : ''}${vars ? ` -v ${vars}` : ''}${page_type ? ` --page-type ${page_type}` : ''}${priority ? ` --priority ${priority}` : ''}${job_id ? ` --job-id ${job_id}` : ''}${quiet ? ' --quiet' : ''}`;

    try {
      // Execute the parser tester using spawn to capture exit code
      const result = await new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve, reject) => {
        const child = spawn('ruby', [
          'scraping/parser_tester.rb',
          '-s', scraper_dir,
          '-p', parser_path,
          ...(html_file ? ['--html', html_file] : []),
          ...(url ? ['-u', url] : []),
          ...(vars ? ['-v', vars] : []),
          ...(page_type ? ['--page-type', page_type] : []),
          ...(priority ? ['--priority', priority.toString()] : []),
          ...(job_id ? ['--job-id', job_id.toString()] : []),
          ...(quiet ? ['--quiet'] : [])
        ], {
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
5. **Test with simpler HTML**: Use a minimal HTML file to isolate issues`;
        
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
4. **Once HTML testing is successful**, you can test with live URLs using the \`-u\` flag

**Example Live URL Testing:**
\`\`\`
parser_tester --scraper "./generated_scraper" --parser "parsers/details.rb" -u "https://example.com/product/123"
\`\`\``;
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
1. **Always test with HTML files first** before using live URLs
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
