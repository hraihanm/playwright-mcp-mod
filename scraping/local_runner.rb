#!/usr/bin/env ruby
# local_runner.rb - Local DataHen V3 pipeline runner
#
# Mimics the DataHen V3 scraper runtime locally:
#   - Runs the seeder script to populate the page queue
#   - Fetches pages via HTTP (with GID-based caching)
#   - Routes pages to the correct parser via config.yaml page_type
#   - save_pages() and save_outputs() work like the real platform
#   - Persists queue + outputs in <scraper_dir>/.local-state/
#
# Usage:
#   ruby local_runner.rb -s <scraper_dir> seed
#   ruby local_runner.rb -s <scraper_dir> step [--count N] [--page-type TYPE]
#   ruby local_runner.rb -s <scraper_dir> status
#   ruby local_runner.rb -s <scraper_dir> pages [--page-type TYPE] [--status STATUS]
#   ruby local_runner.rb -s <scraper_dir> outputs [--collection NAME] [--limit N]
#   ruby local_runner.rb -s <scraper_dir> reset

require 'nokogiri'
require 'net/http'
require 'json'
require 'yaml'
require 'uri'
require 'digest'
require 'fileutils'
require 'time'
require 'optparse'

class LocalRunner
  STATE_DIR   = '.local-state'.freeze
  QUEUE_FILE  = 'queue.json'.freeze
  OUTPUTS_DIR = 'outputs'.freeze
  CACHE_DIR   = 'cache'.freeze

  attr_reader :scraper_dir, :config

  def initialize(scraper_dir, options = {})
    @scraper_dir = File.expand_path(scraper_dir)
    @quiet       = options[:quiet]   || false
    @delay       = options[:delay]   || 0.5
    @job_id      = options[:job_id]  || 12345

    raise "Scraper directory not found: #{@scraper_dir}" unless Dir.exist?(@scraper_dir)

    config_path = File.join(@scraper_dir, 'config.yaml')
    raise "config.yaml not found in: #{@scraper_dir}" unless File.exist?(config_path)

    @config = YAML.load(File.read(config_path), permitted_classes: [Symbol]) rescue YAML.load(File.read(config_path))

    @state_dir   = File.join(@scraper_dir, STATE_DIR)
    @queue_file  = File.join(@state_dir, QUEUE_FILE)
    @outputs_dir = File.join(@state_dir, OUTPUTS_DIR)
    @cache_dir   = File.join(@state_dir, CACHE_DIR)

    FileUtils.mkdir_p([@state_dir, @outputs_dir, @cache_dir])

    @queue           = load_queue
    @pending_pages   = []
    @pending_outputs = []
  end

  # ─────────────────────────────────────────────────────────────────
  # Commands
  # ─────────────────────────────────────────────────────────────────

  def seed
    seeder_cfg = @config['seeder']
    raise "No seeder defined in config.yaml" unless seeder_cfg

    seeder_file = File.expand_path(seeder_cfg['file'], @scraper_dir)
    raise "Seeder file not found: #{seeder_file}" unless File.exist?(seeder_file)

    if seeder_cfg['disabled']
      log "Seeder is disabled in config.yaml"
      return
    end

    log "=== Running Seeder ==="
    log "File: #{seeder_cfg['file']}"

    seeder_pages = []
    $local_runner_instance = self

    binding_obj = make_seeder_binding(seeder_pages)

    run_in_scraper_dir do
      load_lib_files
      eval(File.read(seeder_file), binding_obj, seeder_file)
    end

    remaining = binding_obj.local_variable_get(:pages) || []
    all_pages = @pending_pages + remaining
    @pending_pages = []

    added = 0
    all_pages.each { |p| added += 1 if enqueue(normalize_page(p)) }
    persist_queue

    log "\nSeeder done: #{added} pages added (#{all_pages.size - added} duplicates skipped)"
    print_status
  end

  def step(count: 1, page_type: nil)
    batch = dequeue_batch(count, page_type)

    if batch.empty?
      log "No pages available#{page_type ? " of type '#{page_type}'" : ""}."
      return
    end

    log "=== Processing #{batch.size} page(s) ==="

    batch.each_with_index do |page, i|
      log "\n[#{i + 1}/#{batch.size}] #{page['page_type']} | #{page['url']}"

      begin
        process_page(page)
      rescue => e
        log "  ERROR: #{e.message}"
        log "  #{e.backtrace.first(2).join("\n  ")}" unless @quiet
        page['status'] = 'parsing_failed'
        page['parsing_failed_at'] = Time.now.iso8601
      end

      update_page_in_queue(page)
      persist_queue

      sleep(@delay) if i < batch.size - 1 && @delay > 0
    end

    print_status
  end

  def status
    print_status(verbose: true)
  end

  def pages_list(page_type: nil, status_filter: nil, limit: 20)
    list = @queue
    list = list.select { |p| p['page_type'] == page_type }    if page_type
    list = list.select { |p| p['status']    == status_filter } if status_filter

    puts "Pages (#{list.size} shown / #{@queue.size} total):"
    puts '-' * 80
    list.first(limit).each do |p|
      vars_str = p['vars'] && !p['vars'].empty? ? "  vars=#{p['vars'].inspect}" : ''
      puts "  [#{p['status']}] #{p['page_type']} | #{p['url']}#{vars_str}"
    end
    puts "  ... and #{list.size - limit} more" if list.size > limit
  end

  def outputs_show(collection: nil, limit: 5)
    files = Dir.glob(File.join(@outputs_dir, '*.json'))

    if files.empty?
      puts "No outputs collected yet."
      return
    end

    files.sort.each do |f|
      coll = File.basename(f, '.json')
      next if collection && coll != collection

      records = JSON.parse(File.read(f)) rescue []
      puts "\n=== Collection: #{coll} (#{records.size} records) ==="
      records.first(limit).each_with_index do |r, i|
        puts "  [#{i + 1}] #{JSON.generate(r)}"
      end
      puts "  ... and #{records.size - limit} more" if records.size > limit
    end
  end

  def reset
    FileUtils.rm_rf(@state_dir)
    FileUtils.mkdir_p([@state_dir, @outputs_dir, @cache_dir])
    @queue = []
    log "State reset. Queue, outputs and cache cleared."
  end

  # ─────────────────────────────────────────────────────────────────
  # Public flush helpers (called by save_pages / save_outputs in parsers)
  # ─────────────────────────────────────────────────────────────────

  def flush_pages(pages_array)
    return unless pages_array&.any?
    pages_array.each { |p| @pending_pages << normalize_page(p) }
    pages_array.clear
  end

  def flush_outputs(outputs_array)
    return unless outputs_array&.any?
    @pending_outputs.concat(outputs_array.dup)
    outputs_array.clear
  end

  private

  # ─────────────────────────────────────────────────────────────────
  # Core page processing
  # ─────────────────────────────────────────────────────────────────

  def process_page(page)
    blank = (page['url'] == 'about:blank')

    # ── Fetch ──────────────────────────────────────────────────────
    if blank
      content = ''
      page.merge!(
        'status'               => 'fetched',
        'fetched_at'           => Time.now.iso8601,
        'fetched_from'         => 'skip',
        'response_status'      => '200 OK',
        'response_status_code' => 200,
        'content_type'         => 'text/html',
        'content_size'         => 0,
      )
      log "  [skip] about:blank (no HTTP fetch)"
    else
      content = fetch_content(page)
    end

    # ── Route to parser ────────────────────────────────────────────
    parser_file = find_parser_file(page['page_type'])
    unless parser_file
      log "  WARNING: no parser for page_type '#{page['page_type']}' — marking parsed"
      page['status']    = 'parsed'
      page['parsed_at'] = Time.now.iso8601
      return
    end

    log "  Parser: #{File.basename(parser_file)}"
    page['status'] = 'parsing'
    update_page_in_queue(page)
    persist_queue

    # ── Execute parser ─────────────────────────────────────────────
    @pending_pages   = []
    @pending_outputs = []

    $local_runner_instance = self

    new_pages   = []
    new_outputs = []

    run_in_scraper_dir do
      load_lib_files
      binding_obj = make_parser_binding(page, content, new_pages, new_outputs)
      eval(File.read(parser_file), binding_obj, parser_file)
      new_pages.replace(binding_obj.local_variable_get(:pages)   || [])
      new_outputs.replace(binding_obj.local_variable_get(:outputs) || [])
    end

    all_pages   = @pending_pages + new_pages
    all_outputs = @pending_outputs + new_outputs
    @pending_pages   = []
    @pending_outputs = []

    # Enqueue new pages
    queued = 0
    all_pages.each { |p| queued += 1 if enqueue(normalize_page(p)) }

    # Persist outputs
    saved = write_outputs(all_outputs)

    page['status']    = 'parsed'
    page['parsed_at'] = Time.now.iso8601

    log "  Done: +#{all_pages.size} pages queued (#{queued} new), #{saved} outputs saved"
  end

  # ─────────────────────────────────────────────────────────────────
  # HTTP Fetching
  # ─────────────────────────────────────────────────────────────────

  def fetch_content(page)
    url    = page['url']
    method = (page['method'] || 'GET').upcase
    gid    = page['gid'] ||= generate_gid(url, method)

    cache_file = File.join(@cache_dir, gid)

    if File.exist?(cache_file)
      log "  [cache] #{url}"
      page.merge!(
        'status'      => 'fetched',
        'fetched_at'  => Time.now.iso8601,
        'fetched_from' => 'cache',
      )
      return File.read(cache_file)
    end

    log "  [fetch] #{url}"

    begin
      uri  = URI(url)
      http = Net::HTTP.new(uri.host, uri.port)
      http.use_ssl     = (uri.scheme == 'https')
      http.open_timeout = 30
      http.read_timeout = 60

      req = case method
        when 'POST'   then Net::HTTP::Post.new(uri)
        when 'PUT'    then Net::HTTP::Put.new(uri)
        when 'DELETE' then Net::HTTP::Delete.new(uri)
        else               Net::HTTP::Get.new(uri)
      end

      (page['headers'] || {}).each { |k, v| req[k] = v }
      req.body = page['body'] if page['body'] && method != 'GET'
      default_headers_unless_set(req)

      response = http.request(req)
      content  = response.body.encode('UTF-8', invalid: :replace, undef: :replace, replace: '?')

      page.merge!(
        'status'               => 'fetched',
        'fetched_at'           => Time.now.iso8601,
        'fetched_from'         => 'web',
        'effective_url'        => url,
        'response_status'      => "#{response.code} #{response.message}",
        'response_status_code' => response.code.to_i,
        'content_type'         => response['content-type'] || 'text/html',
        'content_size'         => content.length,
      )

      File.write(cache_file, content)
      content

    rescue => e
      log "  [error] #{e.message}"
      page.merge!(
        'status'               => 'fetching_failed',
        'fetching_failed_at'   => Time.now.iso8601,
        'response_status'      => "0 #{e.message}",
        'response_status_code' => 0,
      )
      ''
    end
  end

  def default_headers_unless_set(req)
    req['User-Agent']      ||= 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    req['Accept']          ||= 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    req['Accept-Language'] ||= 'en-US,en;q=0.9'
  end

  # ─────────────────────────────────────────────────────────────────
  # Binding factories
  # ─────────────────────────────────────────────────────────────────

  def make_seeder_binding(pages)
    # save_pages / save_outputs / finish / limbo defined on LocalRunner class;
    # since binding captures self = this LocalRunner instance, parser/seeder code
    # calls these as instance methods automatically.
    def save_pages(pages_array)
      $local_runner_instance.flush_pages(pages_array)
    end

    def save_outputs(outputs_array)
      $local_runner_instance.flush_outputs(outputs_array)
    end

    def finish; end
    def limbo(_gid = nil); end

    b = binding
    b.local_variable_set(:pages, pages)
    b
  end

  def make_parser_binding(page, content, pages, outputs)
    def save_pages(pages_array)
      $local_runner_instance.flush_pages(pages_array)
    end

    def save_outputs(outputs_array)
      $local_runner_instance.flush_outputs(outputs_array)
    end

    def finish; end
    def limbo(_gid = nil); end

    content_type   = page['content_type'] || 'text/html'
    failed_content = nil
    html = Nokogiri::HTML(content) if content_type.include?('html') && content && !content.empty?

    b = binding
    b.local_variable_set(:content,        content)
    b.local_variable_set(:failed_content, failed_content)
    b.local_variable_set(:page,           page)
    b.local_variable_set(:pages,          pages)
    b.local_variable_set(:outputs,        outputs)
    b.local_variable_set(:html,           html)
    b
  end

  # ─────────────────────────────────────────────────────────────────
  # Queue helpers
  # ─────────────────────────────────────────────────────────────────

  def load_queue
    return [] unless File.exist?(@queue_file)
    JSON.parse(File.read(@queue_file)) rescue []
  end

  def persist_queue
    File.write(@queue_file, JSON.pretty_generate(@queue))
  end

  # Returns true if added (false if duplicate)
  def enqueue(page)
    # Dedup by driver.name if present (about:blank gate pages)
    driver_name = page.dig('driver', 'name')
    if driver_name
      return false if @queue.any? { |p| p.dig('driver', 'name') == driver_name }
    else
      return false if @queue.any? { |p| p['gid'] == page['gid'] && p['page_type'] == page['page_type'] }
    end
    @queue << page
    true
  end

  def update_page_in_queue(page)
    idx = @queue.find_index { |p| p['gid'] == page['gid'] }
    @queue[idx] = page if idx
  end

  # Returns pages to process, marking them as 'fetching'
  def dequeue_batch(count, page_type)
    available = @queue
      .select { |p| p['status'] == 'to_fetch' }
      .select { |p| page_type.nil? || p['page_type'] == page_type }
      .sort_by { |p| [-(p['priority'] || 0), p['created_at'] || ''] }
      .first(count)

    available.each { |p| p['status'] = 'fetching' }
    persist_queue
    available
  end

  # ─────────────────────────────────────────────────────────────────
  # Output persistence
  # ─────────────────────────────────────────────────────────────────

  def write_outputs(records)
    return 0 if records.empty?

    # Group by collection
    by_coll = records.group_by { |r| (r['_collection'] || r[:_collection] || 'default').to_s }

    total = 0
    by_coll.each do |coll, recs|
      out_file = File.join(@outputs_dir, "#{coll}.json")
      existing = File.exist?(out_file) ? (JSON.parse(File.read(out_file)) rescue []) : []

      recs.each do |raw|
        r = raw.transform_keys(&:to_s)
        r['_job_id']     = @job_id
        r['_created_at'] = Time.now.iso8601

        # Dedup by _id
        existing.reject! { |e| e['_id'] && e['_id'] == r['_id'] } if r['_id']

        existing << r
        total += 1
      end

      File.write(out_file, JSON.pretty_generate(existing))
    end

    total
  end

  # ─────────────────────────────────────────────────────────────────
  # Normalization + GID
  # ─────────────────────────────────────────────────────────────────

  def normalize_page(raw)
    p = raw.transform_keys(&:to_s)

    # Convert symbol-keyed nested hashes (vars, driver, headers)
    %w[vars driver headers].each do |k|
      p[k] = p[k].transform_keys(&:to_s) if p[k].is_a?(Hash)
    end

    url    = p['url'] || 'about:blank'
    method = (p['method'] || 'GET').upcase

    p['url']        = url
    p['method']     = method
    p['page_type']  = p['page_type'] || 'default'
    p['priority']   = (p['priority'] || 0).to_i
    p['vars']     ||= {}
    p['job_id']     = @job_id
    p['created_at'] ||= Time.now.iso8601
    p['status']     = 'to_fetch'
    p['gid']      ||= generate_gid(url, method)
    p
  end

  # Generate a GID that approximates DataHen's real GID algorithm.
  #
  # What DataHen docs confirm is IN the hash:
  #   - url
  #   - method
  #   - driver.name  (driver.code is explicitly NOT included)
  #   - headers (custom headers affect cached content, so likely included)
  #
  # What is NOT included:
  #   - driver.code, vars, page_type, priority (all confirmed or inferred)
  #
  # The exact server-side normalization is undocumented; this is a best-effort
  # local approximation. Use `hen scraper page getgid` for the authoritative value.
  def generate_gid(url, method = 'GET', driver_name: nil, headers: {})
    if url == 'about:blank'
      # about:blank pages are deduplicated by driver.name in the queue.
      # Give each a deterministic GID based on driver.name if present.
      seed = driver_name ? "blank|#{driver_name}" : "blank|#{Time.now.to_f}|#{rand}"
      return "blank-#{Digest::MD5.hexdigest(seed)}"
    end

    hostname = URI(url).host rescue 'unknown'

    # Normalize headers: sort by lowercased key, join as "key:value" pairs
    headers_str = (headers || {})
      .reject { |k, _| k.to_s.downcase == 'user-agent' } # UA not part of cache key
      .sort_by { |k, _| k.to_s.downcase }
      .map { |k, v| "#{k.to_s.downcase}:#{v}" }
      .join('|')

    parts = [url, method.upcase]
    parts << "driver:#{driver_name}" if driver_name
    parts << "headers:#{headers_str}" unless headers_str.empty?

    "#{hostname}-#{Digest::MD5.hexdigest(parts.join('|'))}"
  end

  # ─────────────────────────────────────────────────────────────────
  # Lib loading + directory helpers
  # ─────────────────────────────────────────────────────────────────

  def load_lib_files
    lib_dir = File.join(@scraper_dir, 'lib')
    return unless Dir.exist?(lib_dir)

    Dir.glob(File.join(lib_dir, '*.rb')).sort.each do |f|
      load f
    rescue => e
      log "  Warning: lib/#{File.basename(f)} — #{e.message}"
    end
  end

  def run_in_scraper_dir
    orig = Dir.pwd
    Dir.chdir(@scraper_dir)
    yield
  ensure
    Dir.chdir(orig) rescue nil
  end

  def find_parser_file(page_type)
    parsers = @config['parsers'] || []
    cfg = parsers.find { |p| p['page_type'] == page_type && !p['disabled'] }
    return nil unless cfg

    f = File.expand_path(cfg['file'], @scraper_dir)
    File.exist?(f) ? f : nil
  end

  # ─────────────────────────────────────────────────────────────────
  # Display
  # ─────────────────────────────────────────────────────────────────

  def print_status(verbose: false)
    by_status = @queue.group_by { |p| p['status'] }.transform_values(&:count)

    to_fetch = by_status['to_fetch']      || 0
    fetching = by_status['fetching']      || 0
    parsed   = by_status['parsed']        || 0
    parsing  = by_status['parsing']       || 0
    failed   = (by_status['fetching_failed'] || 0) + (by_status['parsing_failed'] || 0)

    puts "\n=== Queue Status (#{@queue.size} total) ==="
    puts "  to_fetch : #{to_fetch}"
    puts "  fetching : #{fetching}"  if fetching > 0
    puts "  parsing  : #{parsing}"   if parsing  > 0
    puts "  parsed   : #{parsed}"
    puts "  failed   : #{failed}"    if failed   > 0

    if verbose && to_fetch > 0
      by_type = @queue
        .select { |p| p['status'] == 'to_fetch' }
        .group_by { |p| p['page_type'] }
        .transform_values(&:count)
      puts "\n  Pending by page_type:"
      by_type.sort_by { |_, c| -c }.each { |pt, c| puts "    #{pt}: #{c}" }
    end

    output_files = Dir.glob(File.join(@outputs_dir, '*.json'))
    if output_files.any?
      puts "\n=== Outputs ==="
      output_files.sort.each do |f|
        count = (JSON.parse(File.read(f)) rescue []).size
        puts "  #{File.basename(f, '.json')}: #{count} records"
      end
    end
  end

  def log(msg)
    puts msg unless @quiet
  end
end

# ─────────────────────────────────────────────────────────────────
# CLI entry point
# ─────────────────────────────────────────────────────────────────

def main
  options = { count: 1, delay: 0.5, job_id: 12345, limit: 20, quiet: false }

  parser = OptionParser.new do |o|
    o.banner = <<~BANNER
      local_runner.rb — Local DataHen V3 pipeline runner

      Usage:
        ruby local_runner.rb -s <scraper_dir> <command> [options]

      Commands:
        seed      Run the seeder script and populate the page queue
        step      Fetch and parse N pages from the queue
        status    Show queue and output statistics
        pages     List pages in the queue
        outputs   Show collected outputs
        reset     Clear all state (queue, outputs, cache)

    BANNER

    o.on('-s', '--scraper DIR', 'Scraper directory containing config.yaml (required)') { |v| options[:scraper] = v }
    o.on('--count N',       Integer, 'Pages to process per step (default: 1)')         { |v| options[:count] = v }
    o.on('--page-type TYPE',         'Filter by page_type')                             { |v| options[:page_type] = v }
    o.on('--status STATUS',          'Filter pages by status (for pages command)')      { |v| options[:status] = v }
    o.on('--collection NAME',        'Filter outputs by collection name')               { |v| options[:collection] = v }
    o.on('--limit N',       Integer, 'Max items to display (default: 20)')              { |v| options[:limit] = v }
    o.on('--delay SECS',    Float,   'Delay between fetches in seconds (default: 0.5)') { |v| options[:delay] = v }
    o.on('--job-id ID',     Integer, 'Mock job ID (default: 12345)')                    { |v| options[:job_id] = v }
    o.on('--quiet',                  'Suppress verbose output')                         { options[:quiet] = true }
    o.on('-h', '--help', 'Show this help') { puts o; exit }
  end

  parser.parse!
  command = ARGV.shift

  unless command
    puts "Error: command required\n\n"
    puts parser
    exit 1
  end

  unless options[:scraper]
    puts "Error: -s/--scraper is required"
    exit 1
  end

  begin
    runner = LocalRunner.new(options[:scraper], options)

    case command
    when 'seed'
      runner.seed
    when 'step'
      runner.step(count: options[:count], page_type: options[:page_type])
    when 'status'
      runner.status
    when 'pages'
      runner.pages_list(
        page_type:     options[:page_type],
        status_filter: options[:status],
        limit:         options[:limit],
      )
    when 'outputs'
      runner.outputs_show(collection: options[:collection], limit: options[:limit])
    when 'reset'
      runner.reset
    else
      puts "Unknown command: '#{command}'"
      puts "Valid commands: seed, step, status, pages, outputs, reset"
      exit 1
    end

  rescue => e
    puts "ERROR: #{e.message}"
    puts e.backtrace.first(5).join("\n") unless options[:quiet]
    exit 1
  end
end

main if __FILE__ == $0
