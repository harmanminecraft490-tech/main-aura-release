/**
 * WEB SEARCH & RESEARCH ENGINE
 *
 * Provider-abstracted web search. Primary provider: Serper (Google-based).
 * Also supports: Brave, Tavily, Exa.
 *
 * API key is read from process.env.SERPER_API_KEY — NEVER from renderer,
 * localStorage, chat messages, or AI prompts.
 *
 * Architecture:
 *   Aura UI → IPC → main process → WebSearchManager → Provider → Real results
 *
 * REAL RESULTS ONLY. If no provider configured, Aura says so honestly.
 */

import * as https from 'https'
import * as http from 'http'
import * as url from 'url'
import * as zlib from 'zlib'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface SearchResult {
  title: string
  url: string
  snippet: string
  domain: string
  position: number
  publishedDate?: string
  source?: string
  imageUrl?: string
}

export interface NewsResult {
  title: string
  url: string
  snippet: string
  domain: string
  publishedDate?: string
  source?: string
}

export interface SearchResponse {
  success: boolean
  query: string
  results: SearchResult[]
  newsResults?: NewsResult[]
  provider: string
  error?: string
  duration: number
  cached?: boolean
}

export interface PageContent {
  url: string
  title: string
  text: string          // cleaned, no HTML
  headings: string[]
  links: Array<{ text: string; url: string }>
  publishedDate?: string
  wordCount: number
  error?: string
}

export interface ResearchBudget {
  maxSearches: number
  maxSources: number
  maxPagesRead: number
  maxCharsPerPage: number  // ~2k chars per page default
  maxTotalChars: number    // across all pages
  timeoutMs: number
}

const DEFAULT_BUDGET: ResearchBudget = {
  maxSearches: 4,
  maxSources: 6,
  maxPagesRead: 3,
  maxCharsPerPage: 3000,
  maxTotalChars: 8000,
  timeoutMs: 20_000,
}

// ─────────────────────────────────────────────────────────────────────────────
// SSRF protection — never allow internal/private IPs
// ─────────────────────────────────────────────────────────────────────────────

function isSafeUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl)
    // Only allow https/http
    if (!['https:', 'http:'].includes(parsed.protocol)) return false
    const host = parsed.hostname.toLowerCase()
    // Block localhost
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return false
    // Block private IPv4
    const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
    if (ipv4) {
      const [, a, b] = ipv4.map(Number)
      if (a === 10) return false           // 10.0.0.0/8
      if (a === 172 && b >= 16 && b <= 31) return false // 172.16.0.0/12
      if (a === 192 && b === 168) return false           // 192.168.0.0/16
      if (a === 169 && b === 254) return false           // link-local
      if (a === 0) return false
    }
    // Block metadata endpoints
    if (host.includes('169.254') || host.includes('metadata')) return false
    return true
  } catch {
    return false
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP helpers
// ─────────────────────────────────────────────────────────────────────────────

function httpsPost(hostname: string, path: string, body: string, headers: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname, path, method: 'POST', headers: { ...headers, 'Content-Length': Buffer.byteLength(body) } },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
        res.on('error', reject)
      }
    )
    req.on('error', reject)
    req.setTimeout(12_000, () => { req.destroy(); reject(new Error('Request timed out')) })
    req.write(body)
    req.end()
  })
}

function httpsGet(rawUrl: string, headers: Record<string, string> = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(rawUrl)
    const isHttps = parsed.protocol === 'https:'
    const lib = isHttps ? https : http
    const req = (lib as typeof https).get(
      rawUrl,
      { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AuraResearch/1.0)', ...headers } } as Parameters<typeof https.get>[1],
      (res) => {
        // Handle redirects
        if (res.statusCode && [301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          const redirectUrl = new URL(res.headers.location, rawUrl).href
          if (isSafeUrl(redirectUrl)) {
            httpsGet(redirectUrl, headers).then(resolve).catch(reject)
          } else {
            reject(new Error('Redirect blocked by SSRF protection'))
          }
          return
        }
        const chunks: Buffer[] = []
        // Handle gzip
        const encoding = res.headers['content-encoding']
        const stream = encoding === 'gzip' ? res.pipe(zlib.createGunzip()) : res
        stream.on('data', (c: Buffer) => chunks.push(c))
        stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
        stream.on('error', reject)
      }
    )
    req.on('error', reject)
    req.setTimeout(12_000, () => { req.destroy(); reject(new Error('Page read timed out')) })
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Result normalization helpers
// ─────────────────────────────────────────────────────────────────────────────

function getDomain(rawUrl: string): string {
  try { return new URL(rawUrl).hostname.replace(/^www\./, '') } catch { return rawUrl }
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider implementations
// ─────────────────────────────────────────────────────────────────────────────

interface SerperRaw {
  organic?: Array<{ title: string; link: string; snippet?: string; date?: string; source?: string; position?: number }>
  news?: Array<{ title: string; link: string; snippet?: string; date?: string; source?: string }>
  knowledgeGraph?: { title?: string; description?: string }
  answerBox?: { answer?: string; snippet?: string }
}

async function searchSerper(
  query: string,
  apiKey: string,
  opts: { num?: number; gl?: string; hl?: string; tbs?: string; site?: string; type?: 'search' | 'news' }
): Promise<SearchResponse> {
  const started = Date.now()
  const q = opts.site ? `site:${opts.site} ${query}` : query
  const body = JSON.stringify({
    q,
    num: opts.num ?? 8,
    gl: opts.gl ?? 'us',
    hl: opts.hl ?? 'en',
    ...(opts.tbs ? { tbs: opts.tbs } : {}),
  })
  const path = opts.type === 'news' ? '/news' : '/search'
  const raw = await httpsPost('google.serper.dev', path, body, {
    'X-API-KEY': apiKey,
    'Content-Type': 'application/json',
  })
  const data = JSON.parse(raw) as SerperRaw
  const results: SearchResult[] = (data.organic ?? []).map((r, i) => ({
    title: r.title,
    url: r.link,
    snippet: r.snippet ?? '',
    domain: getDomain(r.link),
    position: r.position ?? i + 1,
    publishedDate: r.date,
    source: r.source,
  }))
  const newsResults: NewsResult[] = (data.news ?? []).map(r => ({
    title: r.title,
    url: r.link,
    snippet: r.snippet ?? '',
    domain: getDomain(r.link),
    publishedDate: r.date,
    source: r.source,
  }))
  return {
    success: true,
    query,
    results,
    newsResults: newsResults.length > 0 ? newsResults : undefined,
    provider: 'serper',
    duration: Date.now() - started,
  }
}

interface BraveRaw {
  web?: { results?: Array<{ title: string; url: string; description: string; age?: string; profile?: { name?: string } }> }
}

async function searchBrave(query: string, apiKey: string, num: number): Promise<SearchResponse> {
  const started = Date.now()
  const raw = await httpsGet(
    `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${num}&text_decorations=false`,
    { 'Accept': 'application/json', 'X-Subscription-Token': apiKey }
  )
  const data = JSON.parse(raw) as BraveRaw
  const results: SearchResult[] = (data.web?.results ?? []).map((r, i) => ({
    title: r.title,
    url: r.url,
    snippet: r.description,
    domain: getDomain(r.url),
    position: i + 1,
    publishedDate: r.age,
    source: r.profile?.name,
  }))
  return { success: true, query, results, provider: 'brave', duration: Date.now() - started }
}

interface TavilyRaw {
  results?: Array<{ title: string; url: string; content: string; published_date?: string; score?: number }>
}

async function searchTavily(query: string, apiKey: string, num: number): Promise<SearchResponse> {
  const started = Date.now()
  const body = JSON.stringify({ api_key: apiKey, query, max_results: num, search_depth: 'basic' })
  const raw = await httpsPost('api.tavily.com', '/search', body, { 'Content-Type': 'application/json' })
  const data = JSON.parse(raw) as TavilyRaw
  const results: SearchResult[] = (data.results ?? []).map((r, i) => ({
    title: r.title,
    url: r.url,
    snippet: r.content.slice(0, 500),
    domain: getDomain(r.url),
    position: i + 1,
    publishedDate: r.published_date,
  }))
  return { success: true, query, results, provider: 'tavily', duration: Date.now() - started }
}

// ─────────────────────────────────────────────────────────────────────────────
// Webpage reader — real HTTP fetch + HTML → clean text extraction
// ─────────────────────────────────────────────────────────────────────────────

function extractTextFromHtml(html: string, maxChars: number): PageContent {
  // Extract title
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : 'Untitled'

  // Extract headings
  const headings: string[] = []
  const headingRe = /<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/gi
  let hm: RegExpExecArray | null
  while ((hm = headingRe.exec(html)) !== null && headings.length < 12) {
    const text = hm[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
    if (text.length > 2 && text.length < 200) headings.push(text)
  }

  // Extract links (href + anchor text)
  const links: Array<{ text: string; url: string }> = []
  const linkRe = /<a[^>]+href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi
  let lm: RegExpExecArray | null
  while ((lm = linkRe.exec(html)) !== null && links.length < 20) {
    const href = lm[1]
    const text = lm[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
    if (text.length > 2 && text.length < 120 && href.startsWith('http')) {
      links.push({ text, url: href })
    }
  }

  // Extract published date from meta
  const datePatterns = [
    /property="article:published_time"[^>]*content="([^"]+)"/i,
    /name="date"[^>]*content="([^"]+)"/i,
    /itemprop="datePublished"[^>]*content="([^"]+)"/i,
    /<time[^>]*datetime="([^"]+)"/i,
  ]
  let publishedDate: string | undefined
  for (const pattern of datePatterns) {
    const match = html.match(pattern)
    if (match) { publishedDate = match[1]; break }
  }

  // Remove scripts, styles, nav, footer, header, aside, ads
  let cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<aside[\s\S]*?<\/aside>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')  // strip remaining tags
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s{3,}/g, '\n\n')
    .trim()

  // Deduplicate consecutive identical lines (common in nav menus)
  const lines = cleaned.split('\n')
  const deduped: string[] = []
  let prev = ''
  for (const line of lines) {
    const t = line.trim()
    if (t && t !== prev && t.length > 1) { deduped.push(t); prev = t }
  }
  cleaned = deduped.join('\n').slice(0, maxChars)

  return {
    url: '',
    title,
    text: cleaned,
    headings,
    links,
    publishedDate,
    wordCount: cleaned.split(/\s+/).length,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Simple in-memory cache
// ─────────────────────────────────────────────────────────────────────────────

interface CacheEntry<T> {
  value: T
  expires: number
}

class SimpleCache<T> {
  private map = new Map<string, CacheEntry<T>>()
  constructor(private ttlMs: number) {}

  get(key: string): T | undefined {
    const entry = this.map.get(key)
    if (!entry) return undefined
    if (Date.now() > entry.expires) { this.map.delete(key); return undefined }
    return entry.value
  }

  set(key: string, value: T) {
    this.map.set(key, { value, expires: Date.now() + this.ttlMs })
  }

  clear() { this.map.clear() }
}

const searchCache = new SimpleCache<SearchResponse>(5 * 60_000)   // 5 min
const pageCache   = new SimpleCache<PageContent>(30 * 60_000)      // 30 min

// ─────────────────────────────────────────────────────────────────────────────
// Source ranking
// ─────────────────────────────────────────────────────────────────────────────

const HIGH_QUALITY_DOMAINS = new Set([
  'github.com', 'stackoverflow.com', 'mdn.mozilla.org', 'developer.mozilla.org',
  'docs.python.org', 'nodejs.org', 'reactjs.org', 'react.dev', 'nextjs.org',
  'developer.apple.com', 'developer.android.com', 'learn.microsoft.com',
  'docs.microsoft.com', 'aws.amazon.com', 'cloud.google.com', 'docs.aws.amazon.com',
  'arxiv.org', 'wikipedia.org', 'nature.com', 'sciencedirect.com',
  'openai.com', 'anthropic.com', 'google.com', 'blog.google',
  'techcrunch.com', 'wired.com', 'arstechnica.com', 'theverge.com',
  'reuters.com', 'bbc.com', 'apnews.com', 'npr.org',
])

const LOW_QUALITY_DOMAINS = new Set([
  'quora.com', 'medium.com', 'reddit.com', 'yahoo.com',
])

function rankResults(results: SearchResult[]): SearchResult[] {
  return [...results].sort((a, b) => {
    const aHigh = HIGH_QUALITY_DOMAINS.has(a.domain) ? -2 : 0
    const bHigh = HIGH_QUALITY_DOMAINS.has(b.domain) ? -2 : 0
    const aLow = LOW_QUALITY_DOMAINS.has(a.domain) ? 1 : 0
    const bLow = LOW_QUALITY_DOMAINS.has(b.domain) ? 1 : 0
    return (a.position + aHigh + aLow) - (b.position + bHigh + bLow)
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// WebSearchManager — the public interface
// ─────────────────────────────────────────────────────────────────────────────

export interface SearchOptions {
  num?: number
  country?: string
  language?: string
  recency?: 'hour' | 'day' | 'week' | 'month' | 'year'
  site?: string
  type?: 'search' | 'news'
  bypassCache?: boolean
  /** research() only: read pages matching this domain FIRST (e.g. the exact
   *  site the user named, so "what is in nxtraa.online" actually reads it). */
  preferDomain?: string
}

class WebSearchManager {
  private serperKey: string | null = null
  private braveKey: string | null = null
  private tavilyKey: string | null = null
  private activeProvider: 'serper' | 'brave' | 'tavily' | null = null

  constructor() {
    this.reloadEnv()
  }

  /** Re-read env vars (called on startup and when settings change). */
  reloadEnv() {
    this.serperKey = process.env.SERPER_API_KEY ?? null
    this.braveKey = process.env.BRAVE_SEARCH_API_KEY ?? null
    this.tavilyKey = process.env.TAVILY_API_KEY ?? null

    // Prefer Serper → Brave → Tavily
    if (this.serperKey) this.activeProvider = 'serper'
    else if (this.braveKey) this.activeProvider = 'brave'
    else if (this.tavilyKey) this.activeProvider = 'tavily'
    else this.activeProvider = null
  }

  /** Configure a provider key programmatically (from Settings UI). */
  configure(provider: 'serper' | 'brave' | 'tavily', key: string) {
    if (provider === 'serper') this.serperKey = key
    if (provider === 'brave') this.braveKey = key
    if (provider === 'tavily') this.tavilyKey = key
    if (key) this.activeProvider = provider
  }

  get isConnected(): boolean { return this.activeProvider !== null }
  get provider(): string | null { return this.activeProvider }

  get statusMessage(): string {
    if (!this.activeProvider) {
      return 'Web search is not configured. Set SERPER_API_KEY in your .env.local file and restart Aura.'
    }
    return `Web search connected (${this.activeProvider})`
  }

  private recencyToTbs(r?: SearchOptions['recency']): string | undefined {
    switch (r) {
      case 'hour': return 'qdr:h'
      case 'day': return 'qdr:d'
      case 'week': return 'qdr:w'
      case 'month': return 'qdr:m'
      case 'year': return 'qdr:y'
    }
    return undefined
  }

  /** Execute a real web search. Returns normalized results from the active provider. */
  async search(query: string, opts: SearchOptions = {}): Promise<SearchResponse> {
    if (!this.activeProvider) {
      return { success: false, query, results: [], provider: 'none', error: this.statusMessage, duration: 0 }
    }

    const cacheKey = `${this.activeProvider}:${query}:${JSON.stringify(opts)}`
    if (!opts.bypassCache) {
      const cached = searchCache.get(cacheKey)
      if (cached) return { ...cached, cached: true }
    }

    try {
      let response: SearchResponse
      switch (this.activeProvider) {
        case 'serper':
          response = await searchSerper(query, this.serperKey!, {
            num: opts.num ?? 8,
            gl: opts.country ?? 'us',
            hl: opts.language ?? 'en',
            tbs: this.recencyToTbs(opts.recency),
            site: opts.site,
            type: opts.type,
          })
          break
        case 'brave':
          response = await searchBrave(query, this.braveKey!, opts.num ?? 8)
          break
        case 'tavily':
          response = await searchTavily(query, this.tavilyKey!, opts.num ?? 8)
          break
        default:
          return { success: false, query, results: [], provider: 'none', error: 'No provider', duration: 0 }
      }

      response.results = rankResults(response.results)
      if (!opts.bypassCache) searchCache.set(cacheKey, response)
      return response
    } catch (err) {
      return {
        success: false,
        query,
        results: [],
        provider: this.activeProvider,
        error: err instanceof Error ? err.message : 'Search failed',
        duration: 0,
      }
    }
  }

  /** Search for news specifically. */
  async searchNews(query: string, opts: SearchOptions = {}): Promise<SearchResponse> {
    return this.search(query, { ...opts, type: 'news', recency: opts.recency ?? 'week' })
  }

  /** Read and extract a real webpage. Returns clean text, never raw HTML. */
  async readPage(pageUrl: string, maxChars = 3000): Promise<PageContent> {
    if (!isSafeUrl(pageUrl)) {
      return { url: pageUrl, title: '', text: '', headings: [], links: [], wordCount: 0, error: 'URL blocked by security policy' }
    }

    const cacheKey = `page:${pageUrl}:${maxChars}`
    const cached = pageCache.get(cacheKey)
    if (cached) return cached

    try {
      const html = await httpsGet(pageUrl, {
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip',
      })
      const result = extractTextFromHtml(html, maxChars)
      result.url = pageUrl
      pageCache.set(cacheKey, result)
      return result
    } catch (err) {
      return {
        url: pageUrl,
        title: '',
        text: '',
        headings: [],
        links: [],
        wordCount: 0,
        error: err instanceof Error ? err.message : 'Failed to read page',
      }
    }
  }

  /**
   * High-level research: search + read top sources + synthesize context.
   * Returns a compact context string suitable for the AI (token-budgeted).
   *
   * `onProgress` drives the UI status ("Searching the web…", "Reading …").
   */
  async research(
    query: string,
    opts: SearchOptions = {},
    budget: Partial<ResearchBudget> = {},
    onProgress?: (state: 'searching' | 'reading', target: string) => void
  ): Promise<{ context: string; sources: SearchResult[] }> {
    const b = { ...DEFAULT_BUDGET, ...budget }
    onProgress?.('searching', query)
    const searchResp = await this.search(query, { num: b.maxSources, ...opts })
    if (!searchResp.success || searchResp.results.length === 0) {
      return { context: searchResp.error ?? 'No results found.', sources: [] }
    }

    const topResults = searchResp.results.slice(0, b.maxSources)

    // When the user named a specific site, read that site's own page FIRST so
    // the synthesis reflects the real website, not just search snippets.
    if (opts.preferDomain) {
      const preferred = opts.preferDomain.replace(/^www\./, '').toLowerCase()
      topResults.sort((a, z) => {
        const aMatch = a.domain.replace(/^www\./, '').toLowerCase().includes(preferred) || preferred.includes(a.domain.replace(/^www\./, '').toLowerCase())
        const zMatch = z.domain.replace(/^www\./, '').toLowerCase().includes(preferred) || preferred.includes(z.domain.replace(/^www\./, '').toLowerCase())
        return aMatch === zMatch ? 0 : aMatch ? -1 : 1
      })
    }

    const sourceContexts: string[] = []
    let totalChars = 0
    let pagesRead = 0

    for (const result of topResults) {
      if (totalChars >= b.maxTotalChars) break
      if (pagesRead >= b.maxPagesRead) {
        // Use snippet only for remaining results
        const snippet = `[${result.domain}] ${result.title}\n${result.snippet}`
        sourceContexts.push(snippet)
        continue
      }

      if (isSafeUrl(result.url)) {
        try {
          onProgress?.('reading', result.url)
          const page = await this.readPage(result.url, Math.min(b.maxCharsPerPage, b.maxTotalChars - totalChars))
          if (!page.error && page.text.length > 100) {
            const pageContext = `Source: ${page.title} (${result.domain})\nURL: ${result.url}\n${page.headings.slice(0, 3).join(' · ')}\n\n${page.text}`
            sourceContexts.push(pageContext)
            totalChars += pageContext.length
            pagesRead++
            continue
          }
        } catch { /* fall through to snippet */ }
      }

      // Fallback: use search snippet
      const snippet = `[${result.domain}] ${result.title}\n${result.snippet}`
      sourceContexts.push(snippet)
      totalChars += snippet.length
    }

    const context = sourceContexts.join('\n\n---\n\n')
    return { context, sources: topResults }
  }
}

export const webSearchManager = new WebSearchManager()

// ─────────────────────────────────────────────────────────────────────────────
// Tool definitions (injected into AI only when search is configured)
// ─────────────────────────────────────────────────────────────────────────────

export const WEB_SEARCH_TOOL = {
  type: 'function' as const,
  function: {
    name: 'web_search',
    description:
      'Execute a REAL web search and return actual results from the web. ' +
      'Use when the user needs current information, news, software versions, documentation, or anything time-sensitive. ' +
      'Results are from the real internet via Serper/Google. Never fabricate — only use what this tool returns.\n' +
      'WHEN TO USE: latest news · current events · recent releases · documentation · prices · company info · research.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'A specific, well-formed search query for best results.' },
        num: { type: 'number', description: 'Number of results (1–10, default 6).' },
        recency: { type: 'string', enum: ['hour', 'day', 'week', 'month', 'year'], description: 'Filter results by recency.' },
        site: { type: 'string', description: 'Restrict to a specific domain, e.g. "github.com" or "docs.python.org".' },
        type: { type: 'string', enum: ['search', 'news'], description: 'Search type.' },
      },
      required: ['query'],
    },
  },
}

export const READ_PAGE_TOOL = {
  type: 'function' as const,
  function: {
    name: 'read_webpage',
    description:
      'Fetch and extract content from a REAL public webpage. Returns cleaned text, headings, and key links. ' +
      'Use to read a specific URL returned by web_search or requested by the user. ' +
      'Content is real — do not summarize from memory.\n' +
      'SECURITY: Internal/private URLs are automatically blocked.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The full public URL to read.' },
        max_chars: { type: 'number', description: 'Maximum characters to extract (default 3000).' },
      },
      required: ['url'],
    },
  },
}

export const WEB_RESEARCH_TOOL = {
  type: 'function' as const,
  function: {
    name: 'web_research',
    description:
      'Perform multi-step web research on a topic: search → read sources → extract relevant info → return synthesized context. ' +
      'Use for complex research that benefits from reading multiple sources. Returns a compact, token-efficient context.\n' +
      'The AI synthesizes this into a direct answer with citations.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The research query or question.' },
        recency: { type: 'string', enum: ['hour', 'day', 'week', 'month', 'year'], description: 'Filter by recency for time-sensitive topics.' },
        site: { type: 'string', description: 'Restrict to a domain.' },
        max_sources: { type: 'number', description: 'Max sources to read (default 4).' },
      },
      required: ['query'],
    },
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// TOOL RESULT FORMATTERS — strict tool boundary.
//
// The tool executor must NEVER hand the raw provider payload (SearchResponse /
// PageContent objects with provider, duration, query, wordCount, debug fields)
// to the model or the renderer. If it did, the model would echo the JSON and
// raw "provider":"serper" / "duration":1123 text would appear in the chat.
// These formatters reduce every tool output to compact, research-useful text:
// titles + URLs + short snippets. All provider/debug metadata is stripped here
// so nothing else in the pipeline can leak it.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_SNIPPET_CHARS = 300
const MAX_FORMATTED_CHARS = 6000

/** Deduplicate results by URL while preserving rank order. */
function dedupeResults(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>()
  const out: SearchResult[] = []
  for (const result of results) {
    const key = (result.url || result.title || '').toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(result)
  }
  return out
}

/** Compact, human-readable markdown for a SearchResponse (web_search tool). */
export function formatSearchResults(resp: SearchResponse, maxResults = 8): string {
  if (!resp.success) return resp.error ? `Web search failed: ${resp.error}` : 'Web search returned no results.'

  const lines: string[] = []
  const news = resp.newsResults?.slice(0, 4) ?? []
  if (news.length > 0) {
    lines.push('NEWS:')
    for (const item of news) {
      lines.push(`- ${item.title} — ${item.url}${item.publishedDate ? ` (${item.publishedDate})` : ''}`)
    }
    lines.push('')
  }

  let total = 0
  for (const r of dedupeResults(resp.results).slice(0, maxResults)) {
    const block = [
      `${r.position}. ${r.title}`,
      `   ${r.url}`,
      r.snippet ? `   ${r.snippet.slice(0, MAX_SNIPPET_CHARS)}` : '',
      r.publishedDate ? `   Published: ${r.publishedDate}` : '',
    ]
      .filter(Boolean)
      .join('\n')
    if (total + block.length > MAX_FORMATTED_CHARS) break
    lines.push(block)
    lines.push('')
    total += block.length
  }

  const text = lines.join('\n').trim()
  return text || 'Web search returned no results.'
}

/** Compact, human-readable markdown for a fetched PageContent (read_webpage). */
export function formatPageContent(page: PageContent, maxChars = 4000): string {
  if (page.error) return `Unable to read the page${page.url ? ` (${page.url})` : ''}: ${page.error}`
  const heading = page.headings.length > 0 ? page.headings.slice(0, 5).join(' · ') : ''
  const body = (page.text || '').slice(0, maxChars)
  return [
    `Title: ${page.title || page.url}`,
    `URL: ${page.url}`,
    heading ? `Headings: ${heading}` : '',
    body ? '' : '',
    body,
  ]
    .filter(Boolean)
    .join('\n')
    .trim()
}

/** Compact, human-readable markdown for a research() result (web_research). */
export function formatResearchResult(res: { context: string; sources: SearchResult[] }): string {
  const context = (res.context ?? '').trim()
  const sourceList = dedupeResults(res.sources)
    .slice(0, 6)
    .map((source, index) => `${index + 1}. ${source.title} — ${source.url}`)
    .join('\n')
  const out = [context, sourceList ? `SOURCES:\n${sourceList}` : ''].filter(Boolean).join('\n\n')
  return out.trim() || 'Web research returned no results.'
}
