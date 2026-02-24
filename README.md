## Playwright MCP

An attempt to extend/modify MCP tools for personal purpose

---

### Installation

1. Clone this repository and navigate to its directory:
   ```sh
   git clone <repo-url>
   cd playwright-mcp-mod
   ```
2. Install dependencies:
   ```sh
   npm install
   ```
3. Build the project:
   ```sh
   npm run build
   ```
4. Add MCP details to your config (example):
   ```js
   {
     "mcpServers": {
       "playwright-mod": {
         "command": "npx",
         "args": ["path/to/this_MCP_repo"]
       },
     }
   }
   ```

---

### 🔄 Maintaining Fork with Upstream Updates

This repository is a fork of [Microsoft's Playwright MCP](https://github.com/microsoft/playwright-mcp) with custom modifications. To keep your modifications while syncing upstream updates, see **[MAINTAINING_FORK.md](MAINTAINING_FORK.md)** for detailed instructions.

**Quick Start:**
```bash
# One-time setup: Add upstream remote
.\scripts\setup-upstream.ps1  # Windows PowerShell
# or
./scripts/setup-upstream.sh    # Linux/Mac

# Sync with upstream (creates backup automatically)
.\scripts\sync-upstream.ps1    # Windows PowerShell
# or
./scripts/sync-upstream.sh     # Linux/Mac
```

---

### 🆕 Added Tools & Recent Updates

**Key Updates:**
- ✨ **ENHANCED**: `browser_take_screenshot` - Now includes coordinate metadata for vision-based interactions with `_xy` tools
- ✨ **NEW**: `browser_grep_html` - Grep page HTML with context snippets around matches — token-efficient selector discovery (removes path noise, keeps SVG containers)
- ✨ **NEW**: `browser_view_html` - Get page HTML with configurable script inclusion and sanitization
- ✨ **NEW**: `browser_network_requests_simplified` - Filtered network requests optimized for web scraping (excludes analytics, images, fonts)
- ✨ **NEW**: `browser_network_search` - Search/grep across captured network requests (URLs, headers, response bodies) to find API endpoints returning structured data
- ✨ **NEW**: `browser_network_download` - Download a captured network response body to a file for offline testing (JSON, XML, etc.)
- ✨ **NEW**: `browser_request` - Make arbitrary HTTP requests from the browser context (inheriting cookies/session) and save the response to a file
- ⚠️ **MODIFIED**: `browser_download_page` - Disabled in favor of `browser_view_html` for better token management
- ✨ **ENHANCED**: `parser_tester` - Now supports JSON and XML content files in addition to HTML, with auto-detection from file extension

#### ✨ browser_verify_selector

- **Purpose:**
  - Verifies that a selector matches an element and contextually matches the expected content
  - Supports both exact attribute matching and semantic text similarity matching
  - Can verify single elements or multiple elements in batch
- **Usage:**
  - Use this tool to verify element selection accuracy, especially for dynamic content
  - Parameters:
    - `element` (string): Human-readable element description (e.g., "Product name")
    - `selector` (string): Selector to verify (e.g., "#product-title")
    - `expected` (string): Expected text or value to find in the element
    - `attribute` (string, optional): Attribute to check instead of text content (e.g., "href", "data-id")
    - `details` (object, optional): Details object from browser_inspect_element
    - `batch` (array, optional): Additional selectors to verify in batch
  - Features:
    - Semantic matching for text content
    - Special handling for semantic labels (name, title, label, heading)
    - Detailed confidence scoring and explanations
    - Supports batch verification
- **Read-only:** true

#### ✨ datahen_run

- **Purpose:**
  - Run the local DataHen V3 pipeline runner to mimic the real DataHen scraper lifecycle on your machine.
  - Executes the seeder, fetches pages via HTTP, routes them to the correct parser via `config.yaml`, and persists outputs — all without deploying to DataHen.
  - State is stored in `<scraper_dir>/.local-state/` (queue, outputs, HTTP cache).
- **Usage:**
  - Use this tool to test the full scraper pipeline end-to-end: seed → step → outputs.
  - Use `page_type` filter to process one parser at a time during development.
  - Workflow: `seed` → `status` → `step --page-type categories` → `step --page-type listings --count 3` → `outputs`
- **Parameters:**
  - `scraper_dir` (string, required): Absolute path to scraper directory containing `config.yaml`.
  - `command` (enum, required): `seed` | `step` | `status` | `pages` | `outputs` | `reset`
  - `count` (number, optional, default: 1): Pages to fetch+parse per `step`.
  - `page_type` (string, optional): Filter by `page_type` for `step` and `pages` commands.
  - `status_filter` (string, optional): Filter pages by status for `pages` command.
  - `collection` (string, optional): Filter by collection name for `outputs` command.
  - `limit` (number, optional, default: 20): Max items to display.
  - `delay` (number, optional, default: 0.5): Seconds between HTTP fetches.
  - `quiet` (boolean, optional, default: false): Suppress verbose output.
- **Commands:**
  - **`seed`** — Runs `seeder/seeder.rb`, populates `.local-state/queue.json` with initial pages.
  - **`step`** — Fetches N pages from queue, runs their parsers, enqueues new pages, saves outputs. `save_pages()` and `save_outputs()` work as in real DataHen (flush + clear array).
  - **`status`** — Shows queue counts (to_fetch / parsed / failed) and output collection sizes.
  - **`pages`** — Lists pages in the queue with status and vars.
  - **`outputs`** — Shows collected outputs per collection.
  - **`reset`** — Clears all state (queue, outputs, cache).
- **State structure:**
  ```
  <scraper_dir>/
  └── .local-state/
      ├── queue.json          # page queue (status lifecycle)
      ├── outputs/
      │   ├── products.json   # outputs by collection
      │   └── default.json
      └── cache/
          └── <gid>           # cached HTTP responses by GID
  ```
- **Read-only:** true

#### ✨ browser_grep_html

- **Purpose:**
  - Search the current page HTML for a string or regex and return context snippets around matches.
  - Token-efficient alternative to `browser_view_html` for targeted selector discovery.
  - Ideal for finding CSS class names, data attributes, and DOM structure around known text content (product names, prices, labels).
- **Usage:**
  - Use this tool when you know a piece of text on the page and want to discover the CSS selector for it.
  - Sanitizes HTML by default: removes scripts, styles, and SVG path/shape data while **keeping SVG container elements** (`<svg>`, `<g>`, `<use>`) so icon class names remain visible.
  - Workflow: navigate to page → `browser_grep_html({query: "Add to Cart"})` → see surrounding DOM with class names → write CSS selector
- **Parameters:**
  - `query` (string, required): Search string or regex pattern.
  - `isRegex` (boolean, optional, default: false): Treat query as a regular expression.
  - `contextChars` (number, optional, default: 200): Characters of HTML context to show before and after each match.
  - `maxMatches` (number, optional, default: 20): Maximum number of snippets to return.
  - `includeScripts` (boolean, optional, default: false): Include script content when searching.
  - `sanitize` (boolean, optional, default: true): Sanitize HTML before searching.
- **Features:**
  - **Context snippets** - Shows surrounding HTML with `>>>match<<<` markers
  - **Path-aware sanitization** - Removes `<path>`, `<circle>`, `<rect>` and SVG filter elements but keeps `<svg>`, `<g>`, `<use>` containers so icon classes are visible
  - **Token-efficient** - Returns only snippets around matches, not the full page HTML
  - **Regex support** - Full regex pattern matching with case-insensitive search
- **Example Output:**
  ```
  ## HTML Grep Results
  Query: "Add to Cart"
  Found: 3 match(es) in 45231 chars of HTML (sanitized: styles/paths removed, SVG containers kept)
  Showing: 3 snippet(s)

  --- Match 1 of 3 ---
  ...<div class="product-actions"><button class="btn btn-primary add-to-cart" data-product-id="12345"><svg class="icon-cart" width="20" height="20"><use href="#icon-cart"/></svg>
  >>>Add to Cart<<<</button></div>...
  ```
- **Read-only:** true

#### ✨ browser_view_html

- **Purpose:**
  - Get the HTML content of the current page with configurable options for scripts and sanitization.
  - Provides the full HTML content directly to the agent without saving to files.
- **Usage:**
  - Use this tool to retrieve page HTML content for analysis, parsing, or debugging.
  - Configure `includeScripts` and `isSanitized` parameters to control content and token usage.
- **Parameters:**
  - `includeScripts` (boolean, optional, default: false): Whether to include script tags in the HTML output. Defaults to false to reduce token usage.
  - `isSanitized` (boolean, optional, default: true): Whether to sanitize the HTML content. Defaults to true to reduce token usage and remove potentially sensitive content.
- **Features:**
  - **Configurable script inclusion/exclusion** - Control whether to include JavaScript code
  - **Advanced HTML sanitization** - Removes all SVG elements, scripts, and styles.
  - **Token usage optimization** - Smart defaults to minimize token consumption
  - **Direct HTML content return** - No file saving required, content returned directly to agent
- **Read-only:** true

#### ⚠️ browser_download_page (DISABLED)

- **Status:** Currently disabled - use `browser_view_html` instead
- **Purpose:** (Previously) Download the current page HTML or a specific URL and save it to a local file.
- **Note:** This tool has been disabled to encourage the use of `browser_view_html` which provides better token management and more flexible HTML content access.

#### ✨ browser_inspect_element

- **Purpose:**
  - Allows you to reveal the selector and DOM tree details of an internal reference in the browser.
  - Supports inspecting a single element or multiple elements in batch.
- **Usage:**
  - Use this tool to programmatically inspect elements, retrieve their selectors, and understand their DOM structure for automation or debugging purposes.
  - Parameters:
    - `element` (string): Human-readable element description for permission.
    - `ref` (string): Exact target element reference from the page snapshot.
    - `batch` (array, optional): Additional elements to inspect in batch.
- **Read-only:** true

#### ✨ browser_network_requests_simplified

- **Purpose:**
  - Returns filtered network requests excluding analytics, tracking, images, and fonts
  - Optimized for web scraping workflows to identify API calls and pagination requests
  - Includes query parameters and POST body data for easier endpoint identification
- **Usage:**
  - Use this tool when building scrapers to identify relevant API endpoints, pagination patterns, and data fetching requests
  - Much cleaner output than `browser_network_requests` - filters out noise from analytics and static assets
  - Perfect for DataHen scraper development where you need to identify pagination URLs and API endpoints
- **Parameters:**
  - `includeImages` (boolean, optional, default: false): Whether to include image requests in the output
  - `includeFonts` (boolean, optional, default: false): Whether to include font requests in the output
- **Features:**
  - **Smart filtering** - Automatically excludes:
    - Analytics and tracking (Google Analytics, Facebook Pixel, TikTok Analytics, Clarity, etc.)
    - Images (by extension, path patterns, and resource type)
    - Fonts (Google Fonts, etc.)
    - CDN assets and other non-essential resources
  - **Query parameter extraction** - Shows all query parameters from URLs (essential for pagination)
  - **POST body data** - Includes POST request bodies (truncated if >500 chars) for API endpoint analysis
  - **Response status codes** - Shows HTTP status for each request
  - **Configurable filtering** - Options to include images/fonts if needed for specific use cases
- **Example Output:**
  ```
  [GET] https://www.example.com/api/products?page=2 => [200] OK
    Query Params: page=2
  [POST] https://www.example.com/ajax?service=info => [200] OK
    Query Params: service=info
    Body: {"action":"get_data","id":123}
  ```
- **Read-only:** true

#### ✨ browser_network_search

- **Purpose:**
  - Search captured network requests like Chrome DevTools Network tab search
  - Grep a query (string or regex) across URLs, request/response headers, and response bodies
  - Returns context snippets around matches with `>>>highlight<<<` markers
  - Enables API-based scraping workflows where product data comes from XHR/fetch JSON responses
- **Usage:**
  - Use this tool after page load to discover API endpoints that return structured data (product names, prices, JSON fields)
  - Pair with `browser_evaluate` to replay discovered API calls with `fetch()`
  - Workflow: Navigate to page → `browser_network_search({query: "product_name"})` → identify API endpoint → use `browser_evaluate` with `fetch()` to get full response
- **Parameters:**
  - `query` (string, required): Search string or regex pattern to find in network requests
  - `isRegex` (boolean, optional, default: false): Treat query as a regular expression
  - `searchIn` (array, optional, default: `['url','requestBody','responseBody']`): Which fields to search. Options: `url`, `requestHeaders`, `requestBody`, `responseHeaders`, `responseBody`
  - `contextChars` (number, optional, default: 120): Characters of context to show before/after each match
  - `maxResults` (number, optional, default: 20): Maximum number of matching requests to return
  - `maxMatchesPerField` (number, optional, default: 3): Maximum excerpts per field per request
  - `includeFilteredDomains` (boolean, optional, default: false): Include analytics/tracking domains normally filtered out
- **Features:**
  - **Multi-field search** - Searches across URLs, headers, and response bodies in a single call
  - **Context snippets** - Shows surrounding text around matches with `>>>highlight<<<` markers for easy identification
  - **Binary safety** - Automatically skips binary responses (images, PDFs, fonts, etc.) and responses >5MB
  - **Shared filtering** - Uses the same analytics/tracking domain filter as `browser_network_requests_simplified`
  - **Match statistics** - Reports total field length, total matches, and number of excerpts shown per field
  - **Regex support** - Full regex pattern matching with case-insensitive search
- **Example Output:**
  ```
  ## Network Search Results
  Query: "product_name" | Searched in: url, requestBody, responseBody
  Found: 3 matching requests (out of 42 total)

  ---
  ### [1] [GET] https://api.example.com/v2/products?page=1 => [200] OK
  Resource type: fetch | Content-Type: application/json

  **responseBody** (15234 chars, 8 matches, showing 3):
    ...{">>>product_name<<<":"Head & Shoulders 400ml","price":299...
    ...">>>product_name<<<":"Dove Soap 100g","sku":"DS100"...
  ```
- **Read-only:** true

#### ✨ browser_network_download

- **Purpose:**
  - Download a captured network response body to a file
  - Searches captured requests (from the current page load) for a URL matching a given pattern
  - Saves the response body to a specified output path
  - Useful for saving API JSON/XML responses for offline parser testing with `parser_tester`
- **Usage:**
  - First navigate to a page and let API calls fire, then use this tool to save a response body
  - Pair with `browser_network_search` to find the right URL pattern first
  - Workflow: `browser_navigate(url)` → `browser_network_search({query: "products"})` → `browser_network_download({urlPattern: "api.example.com/products", outputPath: "D:\\cache\\products.json"})`
- **Parameters:**
  - `urlPattern` (string, required): Substring or regex pattern to match against captured request URLs
  - `isRegex` (boolean, optional, default: false): Treat urlPattern as a regular expression
  - `outputPath` (string, required): Absolute path to save the response body to
  - `matchIndex` (number, optional, default: 0): Which match to download if multiple requests match (0 = first)
  - `includeFilteredDomains` (boolean, optional, default: false): Include analytics/tracking domains normally filtered out
- **Features:**
  - **URL pattern matching** - Substring or regex matching against captured request URLs
  - **Multiple match support** - Select which match to download when multiple requests match
  - **Binary safety** - Automatically skips binary responses (images, fonts, etc.) and responses >5MB
  - **Directory creation** - Automatically creates output directory if it doesn't exist
  - **Shared filtering** - Uses the same analytics/tracking domain filter as `browser_network_search`
- **Example Output:**
  ```
  ## Network Response Downloaded
  URL: https://api.example.com/v2/categories
  Method: GET | Status: 200 OK
  Content-Type: application/json
  Content-Length: 15234 chars
  Saved to: D:\scraper\cache\categories-api.json

  Matched 3 request(s) for pattern "categories", downloaded match #0.
  ```
- **Read-only:** true

#### ✨ browser_request

- **Purpose:**
  - Make an arbitrary HTTP request from the browser context and save the response to a file
  - Uses `page.evaluate(fetch())` to run inside the browser tab, automatically inheriting cookies, auth tokens, and CORS context
  - Useful for replaying API calls discovered via `browser_network_search` or forging new API requests
- **Usage:**
  - First navigate to a page to establish browser session (cookies, auth), then use this tool to make API calls
  - The request inherits the browser's cookies and session context automatically
  - Workflow: `browser_navigate(url)` → `browser_request({url: "https://api.example.com/v2/products", method: "GET", outputPath: "D:\\cache\\products.json"})`
- **Parameters:**
  - `url` (string, required): Full URL to request
  - `method` (enum, optional, default: "GET"): HTTP method: GET, POST, PUT, DELETE, PATCH
  - `headers` (object, optional, default: {}): Custom request headers as key-value pairs
  - `body` (string, optional): Request body (for POST/PUT/PATCH requests)
  - `outputPath` (string, required): Absolute path to save the response body to
- **Features:**
  - **Browser context inheritance** - Automatically inherits cookies, auth tokens, and CORS context from the active page
  - **Multiple HTTP methods** - Supports GET, POST, PUT, DELETE, PATCH
  - **Custom headers** - Pass any request headers (API keys, Accept headers, etc.)
  - **Request body** - Send request bodies for POST/PUT/PATCH operations
  - **Directory creation** - Automatically creates output directory if it doesn't exist
  - **Size protection** - Skips responses larger than 5MB
- **Example Output:**
  ```
  ## HTTP Request Completed
  [POST] https://api.example.com/v2/products/search => [200] OK
  Content-Type: application/json
  Response size: 23456 chars
  Saved to: D:\scraper\cache\products-search.json
  ```
- **Read-only:** true

#### ✨ browser_take_screenshot (Enhanced)

- **Purpose:**
  - Take screenshots of the current page with coordinate metadata for vision-based interactions
  - Enables AI agents to recognize elements visually and interact with them using coordinate-based tools
  - Supports viewport, full-page, and element-specific screenshots
- **Usage:**
  - Use this tool when you need visual recognition of page elements (buttons, forms, etc.)
  - The screenshot includes coordinate metadata that can be used with `browser_mouse_click_xy`, `browser_mouse_move_xy`, and `browser_mouse_drag_xy`
  - Workflow: Take screenshot → AI recognizes element coordinates → Call `_xy` tool with coordinates
- **Parameters:**
  - `raw` (boolean, optional): Whether to return without compression (PNG format). Default is false (JPEG).
  - `filename` (string, optional): File name to save the screenshot. Defaults to `page-{timestamp}.{png|jpeg}`
  - `element` (string, optional): Human-readable element description for element screenshots
  - `ref` (string, optional): Exact target element reference from page snapshot (required with element)
  - `fullPage` (boolean, optional): When true, captures full scrollable page instead of viewport
- **Features:**
  - **Coordinate metadata** - Includes viewport size, page dimensions, and element bounding boxes
  - **Coordinate system information** - Explains coordinate system (0,0 is top-left)
  - **Element position data** - For element screenshots, provides page coordinates and element center
  - **Tool integration** - Metadata includes instructions for using coordinate-based tools
  - **Vision-based automation** - Enables AI to visually identify and interact with page elements
- **Read-only:** true
- **Requires:** `--caps=vision` for coordinate-based tools (`browser_mouse_click_xy`, etc.)

#### ✨ parser_tester

- **Purpose:**
  - Test DataHen parsers using the Ruby parser_tester.rb script with HTML, JSON, or XML content files
  - Supports API-based scraping workflows where parsers consume JSON/XML responses instead of HTML
  - Provides comprehensive error handling and guidance for web scraping development
- **Usage:**
  - Use this tool to validate parser logic, selector/field accuracy, and data extraction
  - For HTML parsers: provide an HTML file or use auto-download from active browser tab
  - For JSON/XML API parsers: provide a content file (saved via `browser_network_download` or `browser_request`) or use `auto_download_url` to download from a captured network response
  - Parameters:
    - `scraper_dir` (string, required): Path to scraper directory containing config.yaml
    - `parser_path` (string, required): Path to parser file relative to scraper directory
    - `html_file` (string, optional): Path to local HTML file for testing
    - `content_file` (string, optional): Path to content file (JSON, XML, or HTML). Auto-detects type from extension
    - `content_type` (string, optional): Content type override: "json", "xml", or "html". Auto-detected from file extension if not provided
    - `auto_download_url` (string, optional): URL pattern to match when auto-downloading from network responses (downloads response body instead of page HTML)
    - `url` (string, optional): URL to test (only after successful file testing)
    - `vars` (string, optional): JSON string of variables to preload
    - `page_type` (string, optional): Page type (details, listings, category, etc.)
    - `priority` (number, optional): Page priority (default: 500)
    - `job_id` (number, optional): Job ID (default: 12345)
    - `quiet` (boolean, optional): Suppress verbose output (default: true)
    - `auto_download` (boolean, optional): Auto-download content from active browser tab (default: true)
- **Features:**
  - **Multi-format support** - Handles HTML, JSON, and XML content files with auto-detection from file extension
  - **API scraping workflow** - Test parsers that use `JSON.parse(content)` with saved API response files
  - **Network response download** - `auto_download_url` parameter downloads matching captured network responses
  - Comprehensive file validation (scraper directory, config.yaml, parser files, content files)
  - Intelligent error analysis and troubleshooting guidance
  - Integration with `browser_network_download` and `browser_request` for content acquisition
  - Support for variable passing and context management
- **Read-only:** true

---

### Tools

<!--- Tools generated by update-readme.js -->

<details>
<summary><b>Core automation</b></summary>

<!-- NOTE: This has been generated via update-readme.js -->

- **browser_click**
  - Title: Click
  - Description: Perform click on a web page
  - Parameters:
    - `element` (string): Human-readable element description used to obtain permission to interact with the element
    - `ref` (string): Exact target element reference from the page snapshot
    - `doubleClick` (boolean, optional): Whether to perform a double click instead of a single click
    - `button` (string, optional): Button to click, defaults to left
  - Read-only: **false**

<!-- NOTE: This has been generated via update-readme.js -->

- **browser_close**
  - Title: Close browser
  - Description: Close the page
  - Parameters: None
  - Read-only: **true**

<!-- NOTE: This has been generated via update-readme.js -->

- **browser_console_messages**
  - Title: Get console messages
  - Description: Returns all console messages
  - Parameters: None
  - Read-only: **true**

<!-- NOTE: This has been generated via update-readme.js -->

- **browser_drag**
  - Title: Drag mouse
  - Description: Perform drag and drop between two elements
  - Parameters:
    - `startElement` (string): Human-readable source element description used to obtain the permission to interact with the element
    - `startRef` (string): Exact source element reference from the page snapshot
    - `endElement` (string): Human-readable target element description used to obtain the permission to interact with the element
    - `endRef` (string): Exact target element reference from the page snapshot
  - Read-only: **false**

<!-- NOTE: This has been generated via update-readme.js -->

- **browser_evaluate**
  - Title: Evaluate JavaScript
  - Description: Evaluate JavaScript expression on page or element
  - Parameters:
    - `function` (string): () => { /* code */ } or (element) => { /* code */ } when element is provided
    - `element` (string, optional): Human-readable element description used to obtain permission to interact with the element
    - `ref` (string, optional): Exact target element reference from the page snapshot
  - Read-only: **false**

<!-- NOTE: This has been generated via update-readme.js -->

- **browser_file_upload**
  - Title: Upload files
  - Description: Upload one or multiple files
  - Parameters:
    - `paths` (array): The absolute paths to the files to upload. Can be a single file or multiple files.
  - Read-only: **false**

<!-- NOTE: This has been generated via update-readme.js -->

- **browser_handle_dialog**
  - Title: Handle a dialog
  - Description: Handle a dialog
  - Parameters:
    - `accept` (boolean): Whether to accept the dialog.
    - `promptText` (string, optional): The text of the prompt in case of a prompt dialog.
  - Read-only: **false**

<!-- NOTE: This has been generated via update-readme.js -->

- **browser_hover**
  - Title: Hover mouse
  - Description: Hover over element on page
  - Parameters:
    - `element` (string): Human-readable element description used to obtain permission to interact with the element
    - `ref` (string): Exact target element reference from the page snapshot
  - Read-only: **true**

<!-- NOTE: This has been generated via update-readme.js -->

- **browser_navigate**
  - Title: Navigate to a URL
  - Description: Navigate to a URL
  - Parameters:
    - `url` (string): The URL to navigate to
  - Read-only: **false**

<!-- NOTE: This has been generated via update-readme.js -->

- **browser_navigate_back**
  - Title: Go back
  - Description: Go back to the previous page
  - Parameters: None
  - Read-only: **true**

<!-- NOTE: This has been generated via update-readme.js -->

- **browser_navigate_forward**
  - Title: Go forward
  - Description: Go forward to the next page
  - Parameters: None
  - Read-only: **true**

<!-- NOTE: This has been generated via update-readme.js -->

- **browser_network_requests**
  - Title: List network requests
  - Description: Returns all network requests since loading the page
  - Parameters: None
  - Read-only: **true**

<!-- NOTE: This has been generated via update-readme.js -->

- **✨ browser_network_requests_simplified**
  - Title: List network requests (simplified)
  - Description: Returns filtered network requests excluding analytics, tracking, images, and fonts. Useful for identifying API calls and pagination requests for web scraping. Includes query parameters and POST body data when available.
  - Parameters:
    - `includeImages` (boolean, optional): Whether to include image requests in the output. Defaults to false.
    - `includeFonts` (boolean, optional): Whether to include font requests in the output. Defaults to false.
  - Read-only: **true**

<!-- NOTE: This has been generated via update-readme.js -->

- **✨ browser_network_search**
  - Title: Search network requests
  - Description: Search captured network requests like Chrome DevTools Network tab search. Searches across URLs, headers, and response bodies to find API calls containing specific data (e.g., product names, prices, JSON fields). Returns context snippets around matches with >>>highlight<<< markers.
  - Parameters:
    - `query` (string): Search string or regex pattern to find in network requests.
    - `isRegex` (boolean, optional): Treat query as a regular expression. Defaults to false.
    - `searchIn` (array, optional): Which fields to search: url, requestHeaders, requestBody, responseHeaders, responseBody. Defaults to url, requestBody, responseBody.
    - `contextChars` (number, optional): Characters of context before/after each match. Defaults to 120.
    - `maxResults` (number, optional): Maximum matching requests to return. Defaults to 20.
    - `maxMatchesPerField` (number, optional): Maximum excerpts per field per request. Defaults to 3.
    - `includeFilteredDomains` (boolean, optional): Include analytics/tracking domains. Defaults to false.
  - Read-only: **true**

<!-- NOTE: This has been generated via update-readme.js -->

- **✨ browser_network_download**
  - Title: Download network response
  - Description: Download a captured network response body to a file. Searches captured requests for a URL matching the given pattern and saves the response body to the specified output path.
  - Parameters:
    - `urlPattern` (string): Substring or regex pattern to match against captured request URLs.
    - `isRegex` (boolean, optional): Treat urlPattern as a regular expression. Defaults to false.
    - `outputPath` (string): Absolute path to save the response body to.
    - `matchIndex` (number, optional): Which match to download if multiple requests match (0 = first). Defaults to 0.
    - `includeFilteredDomains` (boolean, optional): Include analytics/tracking domains. Defaults to false.
  - Read-only: **true**

<!-- NOTE: This has been generated via update-readme.js -->

- **✨ browser_request**
  - Title: Make HTTP request
  - Description: Make an arbitrary HTTP request from the browser context (inheriting cookies/session) and save the response body to a file.
  - Parameters:
    - `url` (string): Full URL to request.
    - `method` (enum, optional): HTTP method: GET, POST, PUT, DELETE, PATCH. Defaults to GET.
    - `headers` (object, optional): Custom request headers as key-value pairs.
    - `body` (string, optional): Request body (for POST/PUT/PATCH requests).
    - `outputPath` (string): Absolute path to save the response body to.
  - Read-only: **true**

<!-- NOTE: This has been generated via update-readme.js -->

- **browser_press_key**
  - Title: Press a key
  - Description: Press a key on the keyboard
  - Parameters:
    - `key` (string): Name of the key to press or a character to generate, such as `ArrowLeft` or `a`
  - Read-only: **false**

<!-- NOTE: This has been generated via update-readme.js -->

- **browser_resize**
  - Title: Resize browser window
  - Description: Resize the browser window
  - Parameters:
    - `width` (number): Width of the browser window
    - `height` (number): Height of the browser window
  - Read-only: **true**

<!-- NOTE: This has been generated via update-readme.js -->

- **browser_select_option**
  - Title: Select option
  - Description: Select an option in a dropdown
  - Parameters:
    - `element` (string): Human-readable element description used to obtain permission to interact with the element
    - `ref` (string): Exact target element reference from the page snapshot
    - `values` (array): Array of values to select in the dropdown. This can be a single value or multiple values.
  - Read-only: **false**

<!-- NOTE: This has been generated via update-readme.js -->

- **browser_snapshot**
  - Title: Page snapshot
  - Description: Capture accessibility snapshot of the current page, this is better than screenshot
  - Parameters: None
  - Read-only: **true**

<!-- NOTE: This has been generated via update-readme.js -->

- **browser_take_screenshot**
  - Title: Take a screenshot
  - Description: Take a screenshot of the current page. You can't perform actions based on the screenshot, use browser_snapshot for actions.
  - Parameters:
    - `raw` (boolean, optional): Whether to return without compression (in PNG format). Default is false, which returns a JPEG image.
    - `filename` (string, optional): File name to save the screenshot to. Defaults to `page-{timestamp}.{png|jpeg}` if not specified.
    - `element` (string, optional): Human-readable element description used to obtain permission to screenshot the element. If not provided, the screenshot will be taken of viewport. If element is provided, ref must be provided too.
    - `ref` (string, optional): Exact target element reference from the page snapshot. If not provided, the screenshot will be taken of viewport. If ref is provided, element must be provided too.
    - `fullPage` (boolean, optional): When true, takes a screenshot of the full scrollable page, instead of the currently visible viewport. Cannot be used with element screenshots.
  - Read-only: **true**

<!-- NOTE: This has been generated via update-readme.js -->

- **browser_type**
  - Title: Type text
  - Description: Type text into editable element
  - Parameters:
    - `element` (string): Human-readable element description used to obtain permission to interact with the element
    - `ref` (string): Exact target element reference from the page snapshot
    - `text` (string): Text to type into the element
    - `submit` (boolean, optional): Whether to submit entered text (press Enter after)
    - `slowly` (boolean, optional): Whether to type one character at a time. Useful for triggering key handlers in the page. By default entire text is filled in at once.
  - Read-only: **false**

<!-- NOTE: This has been generated via update-readme.js -->

- **✨ browser_verify_selector**
  - Title: Verify selector
  - Description: Verify that a selector matches an element and contextually matches the expected content
  - Parameters:
    - `element` (string): Human-readable element description (e.g., "Product name")
    - `selector` (string): Selector to verify (e.g., "#product-title")
    - `expected` (string): Expected text or value to find in the element
    - `attribute` (string, optional): Attribute to check instead of text content (e.g., "href", "data-id")
    - `details` (object, optional): Details object from browser_inspect_element
    - `batch` (array, optional): Additional selectors to verify in batch
  - Read-only: **true**

<!-- NOTE: This has been generated via update-readme.js -->

- **browser_wait_for**
  - Title: Wait for
  - Description: Wait for text to appear or disappear or a specified time to pass
  - Parameters:
    - `time` (number, optional): The time to wait in seconds
    - `text` (string, optional): The text to wait for
    - `textGone` (string, optional): The text to wait for to disappear
  - Read-only: **true**

<!-- NOTE: This has been generated via update-readme.js -->

- **✨ browser_grep_html**
  - Title: Grep page HTML
  - Description: Search the current page HTML for a string or regex and return context snippets around matches with >>>highlight<<< markers. More token-efficient than browser_view_html for targeted selector discovery. Sanitizes HTML by default: removes scripts, styles, and SVG path/shape data while keeping SVG container elements (svg, g, use) so icon classes remain visible.
  - Parameters:
    - `query` (string): Search string or regex pattern to find in the page HTML.
    - `isRegex` (boolean, optional): Treat query as a regular expression. Defaults to false.
    - `contextChars` (number, optional): Characters of HTML context before/after each match. Defaults to 200.
    - `maxMatches` (number, optional): Maximum number of match snippets to return. Defaults to 20.
    - `includeScripts` (boolean, optional): Include script content when searching. Defaults to false.
    - `sanitize` (boolean, optional): Sanitize HTML before searching. Defaults to true.
  - Read-only: **true**

<!-- NOTE: This has been generated via update-readme.js -->

- **✨ browser_view_html**
  - Title: View page HTML
  - Description: Get the HTML content of the current page with options for including scripts and sanitization.
  - Parameters:
    - `includeScripts` (boolean, optional): Whether to include script tags in the HTML output. Defaults to false to reduce token usage.
    - `isSanitized` (boolean, optional): Whether to sanitize the HTML content. Defaults to true to reduce token usage and remove potentially sensitive content.
  - Read-only: **true**

<!-- NOTE: This has been generated via update-readme.js -->

- **✨ browser_inspect_element**
  - Title: Inspect element
  - Description: Reveal the selector and DOM tree details of an internal reference. Can inspect a single element or multiple elements in batch using the batch parameter.
  - Parameters:
    - `element` (string): Human-readable element description used to obtain permission to interact with the element
    - `ref` (string): Exact target element reference from the page snapshot
    - `batch` (array, optional): Optional array of additional elements to inspect in batch
  - Read-only: **true**

</details>

<details>
<summary><b>Tab management</b></summary>

<!-- NOTE: This has been generated via update-readme.js -->

- **browser_tab_close**
  - Title: Close a tab
  - Description: Close a tab
  - Parameters:
    - `index` (number, optional): The index of the tab to close. Closes current tab if not provided.
  - Read-only: **false**

<!-- NOTE: This has been generated via update-readme.js -->

- **browser_tab_list**
  - Title: List tabs
  - Description: List browser tabs
  - Parameters: None
  - Read-only: **true**

<!-- NOTE: This has been generated via update-readme.js -->

- **browser_tab_new**
  - Title: Open a new tab
  - Description: Open a new tab
  - Parameters:
    - `url` (string, optional): The URL to navigate to in the new tab. If not provided, the new tab will be blank.
  - Read-only: **true**

<!-- NOTE: This has been generated via update-readme.js -->

- **browser_tab_select**
  - Title: Select a tab
  - Description: Select a tab by index
  - Parameters:
    - `index` (number): The index of the tab to select
  - Read-only: **true**

</details>

<details>
<summary><b>Browser installation</b></summary>

<!-- NOTE: This has been generated via update-readme.js -->

- **browser_install**
  - Title: Install the browser specified in the config
  - Description: Install the browser specified in the config. Call this if you get an error about the browser not being installed.
  - Parameters: None
  - Read-only: **false**

</details>

<details>
<summary><b>Coordinate-based (opt-in via --caps=vision)</b></summary>

<!-- NOTE: This has been generated via update-readme.js -->

- **browser_mouse_click_xy**
  - Title: Click
  - Description: Click left mouse button at a given position
  - Parameters:
    - `element` (string): Human-readable element description used to obtain permission to interact with the element
    - `x` (number): X coordinate
    - `y` (number): Y coordinate
  - Read-only: **false**

<!-- NOTE: This has been generated via update-readme.js -->

- **browser_mouse_drag_xy**
  - Title: Drag mouse
  - Description: Drag left mouse button to a given position
  - Parameters:
    - `element` (string): Human-readable element description used to obtain permission to interact with the element
    - `startX` (number): Start X coordinate
    - `startY` (number): Start Y coordinate
    - `endX` (number): End X coordinate
    - `endY` (number): End Y coordinate
  - Read-only: **false**

<!-- NOTE: This has been generated via update-readme.js -->

- **browser_mouse_move_xy**
  - Title: Move mouse
  - Description: Move mouse to a given position
  - Parameters:
    - `element` (string): Human-readable element description used to obtain permission to interact with the element
    - `x` (number): X coordinate
    - `y` (number): Y coordinate
  - Read-only: **true**

</details>

<details>
<summary><b>PDF generation (opt-in via --caps=pdf)</b></summary>

<!-- NOTE: This has been generated via update-readme.js -->

- **browser_pdf_save**
  - Title: Save as PDF
  - Description: Save page as PDF
  - Parameters:
    - `filename` (string, optional): File name to save the pdf to. Defaults to `page-{timestamp}.pdf` if not specified.
  - Read-only: **true**

</details>

<!--- End of tools generated section -->

---

## Changelog

### [Unreleased]

#### Enhanced
- **browser_take_screenshot**: Added coordinate metadata support for vision-based interactions
  - Screenshots now include viewport dimensions, page dimensions, and element bounding box information
  - Added coordinate system documentation in screenshot responses
  - Enables AI agents to visually recognize elements and interact with them using `browser_mouse_click_xy`, `browser_mouse_move_xy`, and `browser_mouse_drag_xy` tools
  - Updated tool description to clarify coordinate-based interaction capabilities

#### Added
- **datahen_run**: Local DataHen V3 pipeline runner — seed, step (fetch+parse), status, pages, outputs, reset; `save_pages()`/`save_outputs()` behave like real DataHen platform
- **browser_grep_html**: Search page HTML with context snippets — token-efficient selector discovery; removes SVG path noise while keeping container elements for icon class visibility
- **browser_view_html**: Get page HTML with configurable script inclusion and sanitization
- **browser_verify_selector**: Verify selector matches and contextually matches expected content
- **browser_inspect_element**: Reveal selector and DOM tree details of internal references
- **browser_network_requests_simplified**: Filtered network requests optimized for web scraping (excludes analytics, images, fonts; includes query params and POST bodies)
- **browser_network_search**: Search/grep across captured network requests (URLs, headers, response bodies) to find API endpoints returning structured data — enables API-based scraping workflows
- **browser_network_download**: Download a captured network response body to a file — save API JSON/XML responses for offline parser testing
- **browser_request**: Make HTTP requests from the browser context (inheriting cookies/session) and save responses — replay or forge API calls for testing
- **parser_tester**: Test DataHen parsers using Ruby parser_tester.rb script — now supports HTML, JSON, and XML content with auto-detection

#### Modified
- **browser_download_page**: Disabled in favor of `browser_view_html` for better token management

#### Changed
- Screenshot tool now returns coordinate metadata alongside images
- Screenshot responses include instructions for using coordinate-based tools
- Improved documentation for vision-based automation workflows
