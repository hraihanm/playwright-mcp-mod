# Parser Tester MCP Tool

The `parser_tester` MCP tool provides a seamless interface between the Playwright MCP environment and the Ruby-based DataHen parser tester script. This tool enforces the mandatory workflow outlined in the GEMINI.md guidelines and provides comprehensive error handling and guidance.

## Overview

The parser tester tool allows agents to test DataHen parsers using either:
- **HTML files** (recommended for initial testing)
- **Live URLs** (only after successful HTML file testing)

## Mandatory Workflow

As per the GEMINI.md guidelines, the tool enforces this sequence:

1. **ALWAYS** download HTML pages first using browser tools
2. **ALWAYS** test with downloaded HTML files using the `--html` flag
3. **ONLY** use live URLs after successful HTML file testing

## Tool Parameters

### Required Parameters
- `scraper_dir`: Path to the scraper directory containing `config.yaml`
- `parser_path`: Path to the parser file relative to scraper directory (e.g., "parsers/details.rb")

### Optional Parameters
- `html_file`: Path to local HTML file for testing (recommended)
- `url`: URL to test (only use after successful HTML file testing)
- `vars`: JSON string of variables to preload
- `page_type`: Page type (details, listings, category, etc.)
- `priority`: Page priority (default: 500)
- `job_id`: Job ID (default: 12345)
- `quiet`: Suppress verbose output (recommended for AI contexts, default: true)

## Usage Examples

### Testing with HTML Files (Recommended)

```typescript
// First download HTML using browser tools
await client.callTool({
  name: 'browser_navigate',
  arguments: { url: 'https://example.com/categories' }
});

await client.callTool({
  name: 'browser_download_page',
  arguments: { filename: 'category-page.html' }
});

// Then test parser with downloaded HTML
await client.callTool({
  name: 'parser_tester',
  arguments: {
    scraper_dir: './generated_scraper',
    parser_path: 'parsers/category.rb',
    html_file: './cache/category-page.html'
  }
});
```

### Testing with Variables

```typescript
await client.callTool({
  name: 'parser_tester',
  arguments: {
    scraper_dir: './generated_scraper',
    parser_path: 'parsers/listings.rb',
    html_file: './cache/listings-page.html',
    vars: '{"category":"electronics","page":1}',
    page_type: 'listings'
  }
});
```

### Testing with Live URLs (After HTML Testing)

```typescript
// Only use after successful HTML file testing
await client.callTool({
  name: 'parser_tester',
  arguments: {
    scraper_dir: './generated_scraper',
    parser_path: 'parsers/details.rb',
    url: 'https://example.com/product/123'
  }
});
```

## Error Handling and Guidance

The tool provides comprehensive error messages and guidance for common issues:

### Missing HTML File or URL
- Enforces the mandatory workflow
- Provides step-by-step instructions for downloading HTML
- Shows example commands

### File System Issues
- Validates scraper directory existence
- Checks for `config.yaml` presence
- Verifies parser file existence
- Confirms HTML file availability

### Execution Errors
- **File Not Found**: Guidance for Ruby installation and path issues
- **Timeout**: Suggestions for infinite loops and performance issues
- **Ruby Syntax**: Help with parser code validation

## Integration with Browser Tools

The parser tester is designed to work seamlessly with other Playwright MCP tools:

1. **Navigation**: Use `browser_navigate` to visit target pages
2. **Download**: Use `browser_download_page` to save HTML content
3. **Testing**: Use `parser_tester` to validate parsers
4. **Iteration**: Refine selectors based on test results

## Best Practices

1. **Always test with HTML files first** before using live URLs
2. **Use browser tools** to verify HTML structure and selectors
3. **Test multiple pages** to ensure parser consistency
4. **Validate variable passing** between parsers
5. **Check data quality** of extracted fields

## Troubleshooting

### Common Issues

1. **Ruby not found**: Ensure Ruby is installed and in PATH
2. **Parser syntax errors**: Use `ruby -c` to validate parser files
3. **Missing dependencies**: Install required Ruby gems
4. **File path issues**: Verify all paths are correct relative to current directory

### Debugging Tips

1. Use `--quiet` flag for cleaner output in AI contexts
2. Check parser output for missing or incorrect data
3. Verify HTML structure matches expected selectors
4. Test with smaller HTML files for performance issues

## Technical Details

- **Capability**: `core`
- **Type**: `readOnly`
- **Timeout**: 60 seconds
- **Dependencies**: Ruby interpreter, parser_tester.rb script
- **Working Directory**: Current process working directory

## File Structure Requirements

The tool expects this directory structure:

```
project_root/
├── scraping/
│   └── parser_tester.rb
├── generated_scraper/
│   ├── config.yaml
│   ├── parsers/
│   │   ├── category.rb
│   │   ├── listings.rb
│   │   └── details.rb
│   └── lib/
└── cache/
    └── downloaded_html_files.html
```

## Security Considerations

- The tool executes Ruby scripts with the current user's permissions
- HTML files are read from the local filesystem
- No network requests are made unless using the `url` parameter
- All file operations are validated before execution

## Future Enhancements

Potential improvements for future versions:
- Support for multiple HTML files in batch testing
- Integration with DataHen CLI commands
- Enhanced output parsing and validation
- Support for custom Ruby gem dependencies
- Performance profiling and optimization suggestions
