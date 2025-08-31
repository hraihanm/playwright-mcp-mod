#!/usr/bin/env ruby

require 'nokogiri'
require 'net/http'
require 'json'
require 'optparse'
require 'uri'
require 'fileutils'
require 'time'
require 'digest'

class ParserTester
  def initialize
    @pages = []
    @outputs = []
    @content = nil
    @page = nil
  end

  def run(url, parser_path, vars = {}, scraper_dir = nil, html_file = nil, options = {})
    @quiet = options[:quiet]
    
    unless @quiet
      puts "=== Parser Tester ==="
    end
    
    if html_file
      load_html_from_file(html_file)
      puts "✓ HTML loaded: #{@content.length} characters" unless @quiet
    elsif url
      fetch_page_content(url)
      puts "✓ Using URL: #{url}" unless @quiet
    else
      puts "Error: Either URL or HTML file is required"
      exit 1
    end
    
    mock_page_variable(url, vars, options)
    
    begin
      execute_parser(parser_path)
      display_results
    rescue => e
      puts "\n✗ Parser execution failed!"
      puts "Error: #{e.message}"
      puts "File: #{e.backtrace.first}"
      puts "\nFull backtrace:"
      puts e.backtrace.join("\n")
      exit 1
    end
  end

  private

  def load_html_from_file(file_path)
    unless File.exist?(file_path)
      raise "HTML file not found: #{file_path}"
    end
    @content = File.read(file_path)
    # Don't output HTML content - just show size
  end

  def fetch_page_content(url)
    cache_file = get_cache_file(url)
    if File.exist?(cache_file)
      cache_age = Time.now - File.mtime(cache_file)
      puts "✓ Loading from cache (#{format_cache_age(cache_age)} old)" unless @quiet
      @content = File.read(cache_file)
      return
    end
    
    puts "Fetching from: #{url}" unless @quiet
    begin
      uri = URI(url)
      http = Net::HTTP.new(uri.host, uri.port)
      http.use_ssl = (uri.scheme == 'https')
      http.open_timeout = 30
      http.read_timeout = 30
      
      request = Net::HTTP::Get.new(uri)
      request['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      request['Accept'] = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      
      response = http.request(request)
      
      if response.code == '200'
        @content = response.body
        puts "✓ Page fetched: #{@content.length} characters" unless @quiet
        cache_content(url, @content)
      else
        puts "✗ HTTP #{response.code}" unless @quiet
        if File.exist?(cache_file)
          puts "✓ Loading from cache due to HTTP error" unless @quiet
          @content = File.read(cache_file)
        else
          @content = "<html><body>Error: HTTP #{response.code}</body></html>"
        end
      end
    rescue => e
      puts "✗ Fetch error: #{e.message}" unless @quiet
      if File.exist?(cache_file)
        puts "✓ Loading from cache due to fetch error" unless @quiet
        @content = File.read(cache_file)
      else
        @content = "<html><body>Error: #{e.message}</body></html>"
      end
    end
  end
  
  def get_cache_file(url)
    # Create cache directory if it doesn't exist
    cache_dir = File.join(Dir.pwd, 'cache')
    Dir.mkdir(cache_dir) unless Dir.exist?(cache_dir)
    
    # Create filename based on URL
    filename = url.gsub(/[^a-zA-Z0-9.-]/, '_') + '.html'
    File.join(cache_dir, filename)
  end
  
  def cache_content(url, content)
    cache_file = get_cache_file(url)
    File.write(cache_file, content)
    
    metadata_file = cache_file.sub('.html', '.meta.json')
    metadata = {
      'url' => url,
      'cached_at' => Time.now.iso8601,
      'content_length' => content.length,
      'content_hash' => Digest::MD5.hexdigest(content)
    }
    File.write(metadata_file, JSON.pretty_generate(metadata))
  end

  def mock_page_variable(url, vars = {}, options = {})
    # Determine if we have content (successful fetch) or failed_content (failed fetch)
    has_content = @content && @content.length > 0
    fetch_successful = has_content
    
    # Use the real DataHen page variable structure
    @page = {
      "gid" => url ? generate_gid(url) : "test-gid-12345",
      "parent_gid" => nil,
      "job_id" => options[:job_id] || 12345,
      "status" => fetch_successful ? "parsed" : "failed",
      "fetch_type" => "browser",
      "hostname" => url ? URI(url).host : "localhost",
      "page_type" => options[:page_type] || "details", # Can be overridden
      "priority" => options[:priority] || 500,
      "method" => "GET",
      "url" => url || "test://localhost",
      "effective_url" => url || "test://localhost",
      "headers" => {
        "Accept" => "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
        "Accept-Encoding" => "gzip, deflate, br, zstd",
        "Accept-Language" => "en-US,en;q=0.9",
        "Referer" => "https://www.google.com/",
        "Sec-Fetch-Dest" => "document",
        "Sec-Fetch-Mode" => "navigate",
        "Sec-Fetch-Site" => "cross-site",
        "Upgrade-Insecure-Requests" => "1",
        "User-Agent" => "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 OPR/110.0.0.0",
        "sec-ch-ua" => '"Chromium";v="124", "Opera";v="110", "Not-A.Brand";v="99"',
        "sec-ch-ua-mobile" => "?0",
        "sec-ch-ua-platform" => '"Windows"'
      },
      "cookie" => "test_session=abc123; test_token=xyz789", # Dummy cookies for testing
      "body" => nil,
      "created_at" => Time.now.iso8601,
      "no_redirect" => false,
      "no_url_encode" => false,
      "no_default_headers" => false,
      "custom_headers" => false,
      "http2" => false,
      "http3" => false,
      "ua_type" => "desktop",
      "freshness" => Time.now.iso8601,
      "fresh" => true,
      "proxy_type" => "",
      "parsing_failed_at" => fetch_successful ? nil : Time.now.iso8601,
      "parsed_at" => fetch_successful ? Time.now.iso8601 : nil,
      "parsing_try_count" => 1,
      "parsing_fail_count" => fetch_successful ? 0 : 1,
      "fetching_at" => "2001-01-01T00:00:00Z",
      "fetched_at" => fetch_successful ? Time.now.iso8601 : nil,
      "fetching_try_count" => 1,
      "refetch_count" => 0,
      "to_fetch" => Time.now.iso8601,
      "fetched_from" => "web",
      "response_checksum" => fetch_successful ? (@content ? Digest::MD5.hexdigest(@content) : "test-checksum") : nil,
      "response_status" => fetch_successful ? "200 " : "500 ",
      "response_status_code" => fetch_successful ? 200 : 500,
      "response_headers" => fetch_successful ? {
        "Cache-Control" => ["max-age=0, must-revalidate, no-cache, no-store, private"],
        "Content-Type" => ["text/html; charset=UTF-8"],
        "Date" => [Time.now.httpdate],
        "Server" => ["test-server"]
      } : nil,
      "response_cookie" => fetch_successful ? "test_session=abc123; test_token=xyz789" : nil,
      "response_proto" => nil,
      "content_type" => fetch_successful ? "text/html; charset=UTF-8" : nil,
      "content_size" => fetch_successful ? (@content ? @content.length : 0) : nil,
      "vars" => vars,
      "failed_response_checksum" => fetch_successful ? nil : "failed-checksum",
      "failed_response_status" => fetch_successful ? nil : "500 ",
      "failed_response_status_code" => fetch_successful ? nil : 500,
      "failed_response_headers" => fetch_successful ? nil : {
        "Content-Type" => ["text/html; charset=UTF-8"],
        "Date" => [Time.now.httpdate]
      },
      "failed_response_cookie" => fetch_successful ? nil : "test_session=abc123; test_token=xyz789",
      "failed_response_proto" => nil,
      "failed_effective_url" => fetch_successful ? nil : (url || "test://localhost"),
      "failed_at" => fetch_successful ? nil : Time.now.iso8601,
      "failed_content_type" => fetch_successful ? nil : "text/html; charset=UTF-8",
      "driver" => nil,
      "display" => nil,
      "screenshot" => nil,
      "driver_log" => nil,
      "max_size" => 0,
      "hard_fetching_try_limit" => nil,
      "hard_refetch_limit" => nil,
      "soft_fetching_try_limit" => nil,
      "soft_refetch_limit" => nil,
      "parsing_try_limit" => nil,
      "enable_global_cache" => nil,
      "retry_interval" => nil,
      "tls" => nil,
      "force_fetch" => false
    }
  end

  def generate_gid(url)
    # Generate a mock GID based on URL hash
    require 'digest'
    Digest::MD5.hexdigest(url)[0..31]
  end

  def execute_parser(parser_path)
    begin
      original_dir = Dir.pwd
      scraper_dir = File.dirname(File.dirname(parser_path))
      Dir.chdir(scraper_dir)

      load_lib_files(scraper_dir)

      parser_filename = "parsers/#{File.basename(parser_path)}"
      parser_code = File.read(parser_filename)

      binding_obj = create_parser_binding

      eval(parser_code, binding_obj)

      @pages = binding_obj.local_variable_get(:pages) || []
      @outputs = binding_obj.local_variable_get(:outputs) || []

      puts "✓ Parser executed successfully" unless @quiet

    rescue => e
      puts "✗ Parser execution error: #{e.message}"
      puts "  #{e.backtrace.first(3).join("\n  ")}"
      
      # Re-raise the error to be handled by the run method
      raise e
    ensure
      Dir.chdir(original_dir) if defined?(original_dir) && Dir.pwd != original_dir
    end
  end

  def load_lib_files(scraper_dir)
    lib_dir = File.join(scraper_dir, 'lib')
    if Dir.exist?(lib_dir)
      Dir.glob(File.join(lib_dir, '*.rb')).each do |lib_file|
        begin
          load lib_file
          # Silent loading - don't output every lib file
        rescue => e
          puts "  ⚠ Warning: #{File.basename(lib_file)} - #{e.message}"
        end
      end
    end
  end

  def create_parser_binding
    pages = @pages
    outputs = @outputs
    
    # Set content and failed_content based on fetch success/failure
    has_content = @content && @content.length > 0
    if has_content
      content = @content        # Successful fetch
      failed_content = nil      # No failed content
    else
      content = nil             # No successful content
      failed_content = @content # Failed content (if any)
    end
    
    page = @page
    html = Nokogiri::HTML(content) if content
    
    def finish
      return
    end
    
    def limbo(gid)
      # Silent mock function
    end
    
    def save_outputs(outputs_array)
      # Silent mock function
    end
    
    binding
  end

  def display_results
    puts "\n=== Results ==="
    
    if @outputs.any?
      puts "Outputs (#{@outputs.length}):"
      # Only show the first few outputs to avoid bloat
      if @outputs.length <= 3
        puts JSON.pretty_generate(@outputs)
      else
        puts JSON.pretty_generate(@outputs.first(3))
        puts "... and #{@outputs.length - 3} more outputs"
      end
    end
    
    if @pages.any?
      puts "\nPages (#{@pages.length}):"
      # Only show the first few pages to avoid bloat
      if @pages.length <= 3
        puts JSON.pretty_generate(@pages)
      else
        puts JSON.pretty_generate(@pages.first(3))
        puts "... and #{@pages.length - 3} more pages"
      end
    end
    
    if @outputs.empty? && @pages.empty?
      puts "No outputs or pages generated"
    end
  end
end

# Cache management methods (accessible from main)
def list_cached_pages
  cache_dir = File.join(Dir.pwd, 'cache')
  unless Dir.exist?(cache_dir)
    puts "No cache directory found."
    return
  end
  
  puts "Cached pages:"
  puts "=" * 50
  
  Dir.glob(File.join(cache_dir, '*.html')).each do |html_file|
    metadata_file = html_file.sub('.html', '.meta.json')
    if File.exist?(metadata_file)
      begin
        metadata = JSON.parse(File.read(metadata_file))
        cache_age = Time.now - Time.parse(metadata['cached_at'])
        puts "#{File.basename(html_file)} - #{metadata['url']}"
        puts "  Size: #{metadata['content_length']} chars, Age: #{format_cache_age(cache_age)}"
      rescue => e
        puts "#{File.basename(html_file)} - Error reading metadata"
      end
    else
      puts "#{File.basename(html_file)} - No metadata"
    end
  end
end

def clear_cache
  cache_dir = File.join(Dir.pwd, 'cache')
  if Dir.exist?(cache_dir)
    FileUtils.rm_rf(cache_dir)
    puts "Cache cleared successfully."
  else
    puts "No cache directory found."
  end
end

def format_cache_age(seconds)
  if seconds < 60
    "#{seconds.to_i} seconds"
  elsif seconds < 3600
    "#{(seconds / 60).to_i} minutes"
  elsif seconds < 86400
    "#{(seconds / 3600).to_i} hours"
  else
    "#{(seconds / 86400).to_i} days"
  end
end

def main
  options = {}
  
  OptionParser.new do |opts|
    opts.banner = "Usage: parser_tester.rb [options]"
    
    opts.on("-s", "--scraper DIR", "Scraper directory containing config.yaml") do |dir|
      options[:scraper] = dir
    end
    
    opts.on("-p", "--parser PATH", "Path to parser file relative to scraper directory") do |path|
      options[:parser] = path
    end
    
    opts.on("-u", "--url URL", "URL to test") do |url|
      options[:url] = url
    end
      
    opts.on("-H", "--html FILE", "Path to local HTML file to use instead of fetching") do |file|
      options[:html] = file
    end
    
    opts.on("-v", "--vars VARS", "JSON string of variables to preload") do |vars|
      options[:vars] = vars
    end
    
    opts.on("--page-type TYPE", "Page type (details, listings, category, etc.)") do |type|
      options[:page_type] = type
    end
    
    opts.on("--priority PRIORITY", Integer, "Page priority (default: 500)") do |priority|
      options[:priority] = priority
    end
    
    opts.on("--job-id ID", Integer, "Job ID (default: 12345)") do |id|
      options[:job_id] = id
    end
    
    opts.on("--quiet", "Suppress verbose output, show only essential results") do
      options[:quiet] = true
    end
    
    opts.on("-h", "--help", "Show this help message") do
      puts opts
      puts "\nExamples:"
      puts "  # Test with verbose output (default)"
      puts "  ruby parser_tester.rb -s './scraper' -p 'parsers/details.rb' --html './page.html'"
      puts "\n  # Test with minimal output (recommended for AI contexts)"
      puts "  ruby parser_tester.rb -s './scraper' -p 'parsers/details.rb' --html './page.html' --quiet"
      exit
    end
    
    opts.on("--list-cache", "List all cached pages") do
      list_cached_pages
      exit
    end
    
    opts.on("--clear-cache", "Clear all cached pages") do
      clear_cache
      exit
    end
  end.parse!
  
  if options[:scraper].nil? || options[:parser].nil?
    puts "Error: Both scraper directory and parser path are required"
    puts "Usage: parser_tester.rb -s <scraper_dir> -p <parser_path> [-u <URL> | --html <FILE>] [-v <vars>]"
    puts "Example: parser_tester.rb -s './generated_scraper' -p 'parsers/details.rb' --html './cache/page.html'"
    exit 1
  end
  
  unless Dir.exist?(options[:scraper])
    puts "Error: Scraper directory not found: #{options[:scraper]}"
    exit 1
  end
  
  config_path = File.join(options[:scraper], 'config.yaml')
  unless File.exist?(config_path)
    puts "Error: config.yaml not found in scraper directory: #{config_path}"
    exit 1
  end
  
  full_parser_path = File.join(options[:scraper], options[:parser])
  unless File.exist?(full_parser_path)
    puts "Error: Parser file not found: #{full_parser_path}"
    exit 1
  end
  
  vars = {}
  if options[:vars]
    begin
      vars = JSON.parse(options[:vars])
    rescue JSON::ParserError => e
      puts "Error: Invalid JSON in vars: #{e.message}"
      exit 1
    end
  end
  
  tester = ParserTester.new
  tester.run(options[:url], full_parser_path, vars, options[:scraper], options[:html], options)
end

if __FILE__ == $0
  main
end
