#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import fetch from 'node-fetch'
import * as cheerio from 'cheerio'
import NodeCache from 'node-cache'
import TurndownService from 'turndown'

// =====================
// Configuration
// =====================
const DOCS_BASE_URL = 'https://docs.humanity.org'
const LLMS_TXT_URL = 'https://docs.humanity.org/llms.txt'
const CACHE_TTL = 3600 // 1 hour
const MAX_CONTENT_LENGTH = 120_000 // keep responses bounded
const MAX_CHUNK_CHARS = 4000 // good chunk size for LLM consumption
const MAX_SEARCH_RESULTS = 10

const cache = new NodeCache({ stdTTL: CACHE_TTL, checkperiod: 600 })

const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
})

// =====================
// Types
// =====================
interface DocMetadata {
  title: string
  description?: string
  apiEndpoints?: string[]
  codeExamples?: string[]
  lastFetched: Date
  url?: string
}

interface CachedDoc {
  content: string // original html or raw text
  markdown: string // normalized markdown (possibly truncated)
  metadata: DocMetadata
}

type Heading = {
  level: number
  text: string
}

type Chunk = {
  id: string
  source: 'llms' | 'page'
  url: string
  path: string
  title: string
  heading: string
  headingLevel: number
  content: string
  startLine: number
  endLine: number
}

type SearchResult = {
  title: string
  url: string
  path: string
  heading: string
  chunkId: string
  score: number
  snippet: string
}

// =====================
// Helpers
// =====================
function normalizePath(path: string): string {
  if (!path) return '/'
  if (path.startsWith('http')) {
    try {
      const u = new URL(path)
      return u.pathname || '/'
    } catch {
      return path
    }
  }
  if (!path.startsWith('/')) return `/${path}`
  return path
}

function toAbsoluteUrl(pathOrUrl: string): string {
  if (!pathOrUrl) return DOCS_BASE_URL
  if (pathOrUrl.startsWith('http')) return pathOrUrl
  const p = normalizePath(pathOrUrl)
  return `${DOCS_BASE_URL}${p}`
}

function clampText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen) + '\n\n[Content truncated...]'
}

function safeId(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 120)
}

function extractMarkdownHeadings(markdown: string): Heading[] {
  const lines = markdown.split('\n')
  const headings: Heading[] = []
  for (const line of lines) {
    const m = line.match(/^(#{1,6})\s+(.+?)\s*$/)
    if (m) headings.push({ level: m[1].length, text: m[2].trim() })
  }
  return headings
}

function extractCodeBlocks(markdownOrText: string, limit = 10): string[] {
  const codeExamples: string[] = []
  const codeBlockRegex = /```[\w-]*\n([\s\S]*?)```/g
  let match: RegExpExecArray | null
  while ((match = codeBlockRegex.exec(markdownOrText)) !== null) {
    const code = (match[1] || '').trim()
    if (code.length > 10 && code.length < 4000) codeExamples.push(code)
    if (codeExamples.length >= limit) break
  }
  return codeExamples
}

// Split markdown into chunks by headings, with soft max size
function chunkMarkdown(opts: {
  markdown: string
  source: 'llms' | 'page'
  url: string
  path: string
  title: string
}): Chunk[] {
  const { markdown, source, url, path, title } = opts
  const lines = markdown.split('\n')

  // Build sections keyed by heading; if no heading, treat as one section
  type Section = {
    heading: string
    headingLevel: number
    startLine: number
    endLine: number
    contentLines: string[]
  }

  const sections: Section[] = []
  let current: Section | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const m = line.match(/^(#{1,6})\s+(.+?)\s*$/)
    if (m) {
      // close previous
      if (current) {
        current.endLine = i - 1
        sections.push(current)
      }
      current = {
        heading: m[2].trim(),
        headingLevel: m[1].length,
        startLine: i,
        endLine: i,
        contentLines: [line],
      }
    } else {
      if (!current) {
        current = {
          heading: 'Introduction',
          headingLevel: 1,
          startLine: 0,
          endLine: 0,
          contentLines: [],
        }
      }
      current.contentLines.push(line)
    }
  }
  if (current) {
    current.endLine = lines.length - 1
    sections.push(current)
  }

  // Now split each section into chunks if too large
  const chunks: Chunk[] = []
  for (const s of sections) {
    const full = s.contentLines.join('\n').trim()
    if (!full) continue

    if (full.length <= MAX_CHUNK_CHARS) {
      const id = safeId(
        `${source}:${path}:${s.heading}:${s.startLine}-${s.endLine}`,
      )
      chunks.push({
        id,
        source,
        url,
        path,
        title,
        heading: s.heading,
        headingLevel: s.headingLevel,
        content: full,
        startLine: s.startLine + 1,
        endLine: s.endLine + 1,
      })
      continue
    }

    // Split oversized section by paragraph boundaries
    const paras = full.split(/\n\s*\n/g)
    let buf: string[] = []
    let bufLen = 0
    let part = 1

    const flush = () => {
      if (buf.length === 0) return
      const content = buf.join('\n\n').trim()
      const id = safeId(`${source}:${path}:${s.heading}:part${part}`)
      chunks.push({
        id,
        source,
        url,
        path,
        title,
        heading: `${s.heading} (part ${part})`,
        headingLevel: s.headingLevel,
        content,
        startLine: s.startLine + 1,
        endLine: s.endLine + 1,
      })
      part++
      buf = []
      bufLen = 0
    }

    for (const p of paras) {
      const pTrim = p.trim()
      if (!pTrim) continue
      if (bufLen + pTrim.length + 2 > MAX_CHUNK_CHARS) flush()
      buf.push(pTrim)
      bufLen += pTrim.length + 2
    }
    flush()
  }

  return chunks
}

function makeSnippet(text: string, q: string, max = 260): string {
  const t = text.replace(/\s+/g, ' ').trim()
  const ql = q.toLowerCase()
  const tl = t.toLowerCase()
  const idx = tl.indexOf(ql)
  if (idx === -1) return t.slice(0, max) + (t.length > max ? '…' : '')
  const start = Math.max(0, idx - 80)
  const end = Math.min(t.length, idx + q.length + 160)
  const snip = t.slice(start, end)
  return (start > 0 ? '…' : '') + snip + (end < t.length ? '…' : '')
}

// simple scoring: heading match > body match; term frequency; short boost
function scoreChunk(chunk: Chunk, query: string): number {
  const q = query.toLowerCase().trim()
  if (!q) return 0
  const terms = q.split(/\s+/).filter(Boolean)
  const heading = `${chunk.title} ${chunk.heading}`.toLowerCase()
  const body = chunk.content.toLowerCase()

  let score = 0
  for (const term of terms) {
    const hCount = (
      heading.match(
        new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
      ) || []
    ).length
    const bCount = (
      body.match(
        new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
      ) || []
    ).length

    score += hCount * 8
    score += bCount * 2

    // small bonus for exact phrase
    if (q.length > 3 && heading.includes(q)) score += 10
    if (q.length > 3 && body.includes(q)) score += 6
  }

  // prefer tighter chunks slightly
  if (chunk.content.length < 2000) score += 1

  return score
}

// =====================
// Fetching
// =====================
async function fetchLlmsTxtRaw(): Promise<string> {
  const cacheKey = 'llms-txt:raw'
  const cached = cache.get<{ raw: string }>(cacheKey)
  if (cached) return cached.raw

  const response = await fetch(LLMS_TXT_URL)
  if (!response.ok) {
    throw new Error(
      `Failed to fetch llms.txt: ${response.status} ${response.statusText}`,
    )
  }
  const raw = await response.text()
  cache.set(cacheKey, { raw })
  return raw
}

async function getLlmsChunks(): Promise<Chunk[]> {
  const cacheKey = 'llms-txt:chunks'
  const cached = cache.get<Chunk[]>(cacheKey)
  if (cached) return cached

  const raw = await fetchLlmsTxtRaw()

  // title from first # heading if present
  const titleMatch = raw.match(/^#\s+(.+)$/m)
  const title = titleMatch
    ? titleMatch[1].trim()
    : 'Humanity Protocol Documentation'

  const markdown = clampText(raw, MAX_CONTENT_LENGTH)
  const chunks = chunkMarkdown({
    markdown,
    source: 'llms',
    url: LLMS_TXT_URL,
    path: '/llms.txt',
    title,
  })

  cache.set(cacheKey, chunks)
  return chunks
}

async function fetchDocumentation(pathOrUrl: string): Promise<CachedDoc> {
  const path = normalizePath(pathOrUrl)
  const cacheKey = `doc:${path}`
  const cached = cache.get<CachedDoc>(cacheKey)
  if (cached) return cached

  // llms.txt special cases
  if (path === '/' || path === '/llms.txt') {
    const llmsTxt = await fetchLlmsTxtRaw()
    const titleMatch = llmsTxt.match(/^#\s+(.+)$/m)
    const title = titleMatch
      ? titleMatch[1].trim()
      : 'Humanity Protocol Documentation'
    const codeExamples = extractCodeBlocks(llmsTxt, 10)

    const doc: CachedDoc = {
      content: llmsTxt,
      markdown: clampText(llmsTxt, MAX_CONTENT_LENGTH),
      metadata: {
        title,
        description: 'Comprehensive Humanity Protocol documentation (llms.txt)',
        apiEndpoints: [],
        codeExamples,
        lastFetched: new Date(),
        url: LLMS_TXT_URL,
      },
    }
    cache.set(cacheKey, doc)
    return doc
  }

  const url = toAbsoluteUrl(pathOrUrl)
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(
      `Failed to fetch ${url}: ${response.status} ${response.statusText}`,
    )
  }

  const html = await response.text()
  const $ = cheerio.load(html)

  // Prefer article content; fallback to main; avoid grabbing the full body if possible
  const mainContent =
    $('article').first().html() ||
    $('main').first().html() ||
    $('.markdown-body').first().html() ||
    $('.content').first().html() ||
    ''

  // Metadata
  const title =
    $('h1').first().text().trim() || $('title').text().trim() || 'Untitled'
  const description =
    $('meta[name="description"]').attr('content') ||
    $('meta[property="og:description"]').attr('content') ||
    ''

  // Extract API endpoints (best-effort)
  const apiEndpoints: string[] = []
  $('code').each((_, el) => {
    const text = $(el).text().trim()
    if (text.match(/^\/(api|v1|v2)\/[a-z0-9\-\/_{}:]+$/i))
      apiEndpoints.push(text)
  })

  // Extract code examples (best-effort)
  const codeExamples: string[] = []
  $('pre code, .code-block code, pre').each((_, el) => {
    const code = $(el).text().trim()
    if (code.length > 10 && code.length < 4000) codeExamples.push(code)
  })

  // Convert to markdown
  const markdown = turndownService.turndown(
    mainContent || $('body').html() || '',
  )
  const finalMarkdown = clampText(markdown, MAX_CONTENT_LENGTH)

  const doc: CachedDoc = {
    content: mainContent,
    markdown: finalMarkdown,
    metadata: {
      title,
      description,
      apiEndpoints: [...new Set(apiEndpoints)],
      codeExamples: codeExamples.slice(0, 10),
      lastFetched: new Date(),
      url,
    },
  }

  cache.set(cacheKey, doc)
  return doc
}

async function getPageChunks(pathOrUrl: string): Promise<Chunk[]> {
  const path = normalizePath(pathOrUrl)
  const cacheKey = `chunks:${path}`
  const cached = cache.get<Chunk[]>(cacheKey)
  if (cached) return cached

  const doc = await fetchDocumentation(pathOrUrl)
  const chunks = chunkMarkdown({
    markdown: doc.markdown,
    source: 'page',
    url: doc.metadata.url || toAbsoluteUrl(pathOrUrl),
    path,
    title: doc.metadata.title,
  })

  cache.set(cacheKey, chunks)
  return chunks
}

async function listPagesFromLlms(): Promise<string[]> {
  const cacheKey = 'llms-txt:pages'
  const cached = cache.get<string[]>(cacheKey)
  if (cached) return cached

  const raw = await fetchLlmsTxtRaw()
  const urls = new Set<string>()

  const re = /https:\/\/docs\.humanity\.org[^\s\)\]]+/g
  const matches = raw.match(re) || []
  for (const u of matches) {
    try {
      const url = new URL(u)
      urls.add(url.pathname)
    } catch {
      // ignore
    }
  }

  const pages = Array.from(urls).sort()
  cache.set(cacheKey, pages)
  return pages
}

// =====================
// Search
// =====================
async function searchDocumentation(
  query: string,
  maxResults = MAX_SEARCH_RESULTS,
): Promise<SearchResult[]> {
  const q = query.trim()
  if (!q) return []

  // Search llms chunks only (fast & comprehensive)
  const chunks = await getLlmsChunks()
  const scored = chunks
    .map((c) => ({
      chunk: c,
      score: scoreChunk(c, q),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(20, maxResults * 3)) // take more then dedupe later

  // Deduplicate by heading/url-ish
  const results: SearchResult[] = []
  const seen = new Set<string>()

  for (const s of scored) {
    const c = s.chunk
    const key = `${c.path}::${c.heading}`.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)

    results.push({
      title: c.title,
      url: c.url, // for llms chunks this is llms.txt; we also try to extract a nearby doc url below
      path: c.path,
      heading: c.heading,
      chunkId: c.id,
      score: s.score,
      snippet: makeSnippet(c.content, q),
    })

    if (results.length >= maxResults) break
  }

  return results
}

async function getChunkById(chunkId: string): Promise<Chunk | null> {
  // Look in llms chunks
  const llms = await getLlmsChunks()
  const foundLlms = llms.find((c) => c.id === chunkId)
  if (foundLlms) return foundLlms

  // If not found, scan cached page chunks keys (bounded by cache)
  // For simplicity: attempt to find in any cached "chunks:*" entries
  const keys = cache.keys().filter((k) => k.startsWith('chunks:'))
  for (const k of keys) {
    const chunks = cache.get<Chunk[]>(k)
    const found = chunks?.find((c) => c.id === chunkId)
    if (found) return found
  }
  return null
}

async function getSectionFromPage(
  pathOrUrl: string,
  heading: string,
): Promise<{
  url: string
  title: string
  heading: string
  content: string
} | null> {
  const doc = await fetchDocumentation(pathOrUrl)
  const md = doc.markdown
  const h = heading.trim().toLowerCase()
  if (!h) return null

  const lines = md.split('\n')
  let start = -1
  let startLevel = 7

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+(.+?)\s*$/)
    if (!m) continue
    const level = m[1].length
    const text = m[2].trim().toLowerCase()
    if (text === h) {
      start = i
      startLevel = level
      break
    }
  }

  if (start === -1) return null

  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+(.+?)\s*$/)
    if (!m) continue
    const level = m[1].length
    if (level <= startLevel) {
      end = i
      break
    }
  }

  const content = lines.slice(start, end).join('\n').trim()
  return {
    url: doc.metadata.url || toAbsoluteUrl(pathOrUrl),
    title: doc.metadata.title,
    heading,
    content: clampText(content, MAX_CONTENT_LENGTH),
  }
}

// =====================
// Actions: generate curl
// =====================
function generateCurl(args: {
  method: string
  url: string
  headers?: Record<string, string>
  query?: Record<string, string | number | boolean>
  jsonBody?: unknown
}): string {
  const method = (args.method || 'GET').toUpperCase()
  let url = args.url

  const qs = args.query || {}
  const params = Object.entries(qs)
    .filter(([_, v]) => v !== undefined && v !== null)
    .map(
      ([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`,
    )

  if (params.length > 0) {
    url += (url.includes('?') ? '&' : '?') + params.join('&')
  }

  const headers = args.headers || {}
  const headerFlags = Object.entries(headers).map(
    ([k, v]) => `-H ${JSON.stringify(`${k}: ${v}`)}`,
  )

  const body =
    args.jsonBody !== undefined
      ? `-d ${JSON.stringify(JSON.stringify(args.jsonBody))}`
      : ''

  const parts = [
    'curl',
    '-sS',
    '-X',
    method,
    ...headerFlags,
    body,
    JSON.stringify(url),
  ].filter(Boolean)

  return parts.join(' ')
}

// =====================
// MCP server setup
// =====================
const server = new Server(
  { name: 'humanity-docs', version: '2.0.0' },
  { capabilities: { tools: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'fetch_docs',
        description:
          'Fetch documentation. Use "/" or "/llms.txt" for comprehensive llms.txt. Use a specific path for individual pages.',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            include_metadata: { type: 'boolean', default: true },
          },
          required: ['path'],
        },
      },
      {
        name: 'list_pages',
        description:
          'List doc page paths referenced in llms.txt (useful for navigation and targeted fetches).',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'get_page_outline',
        description:
          'Return headings (outline) for a page to navigate without fetching everything.',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
      },
      {
        name: 'get_section',
        description:
          'Fetch only a specific section under a heading from a page.',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            heading: { type: 'string' },
          },
          required: ['path', 'heading'],
        },
      },
      {
        name: 'get_chunks',
        description:
          'Get chunked content for a page (or /llms.txt) for precise retrieval.',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            max_chunks: { type: 'number', default: 20 },
          },
          required: ['path'],
        },
      },
      {
        name: 'get_chunk',
        description:
          'Retrieve a single chunk by chunkId (returned from search_docs or get_chunks).',
        inputSchema: {
          type: 'object',
          properties: { chunk_id: { type: 'string' } },
          required: ['chunk_id'],
        },
      },
      {
        name: 'search_docs',
        description:
          'Ranked search over llms.txt chunks. Returns chunkIds so you can fetch exact supporting context.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            max_results: { type: 'number', default: 10 },
          },
          required: ['query'],
        },
      },
      {
        name: 'list_api_endpoints',
        description: 'Extract API endpoints (best-effort) from llms.txt.',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'extract_code_examples',
        description:
          'Extract code examples from a specific documentation page.',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
      },
      {
        name: 'generate_curl',
        description:
          'Generate a curl command for an API call (helps developers copy/paste quickly).',
        inputSchema: {
          type: 'object',
          properties: {
            method: { type: 'string', default: 'GET' },
            url: {
              type: 'string',
              description:
                'Absolute URL preferred (e.g. https://api.example.com/v1/foo)',
            },
            headers: {
              type: 'object',
              additionalProperties: { type: 'string' },
            },
            query: {
              type: 'object',
              additionalProperties: { type: ['string', 'number', 'boolean'] },
            },
            json_body: {},
          },
          required: ['url'],
        },
      },
      {
        name: 'clear_cache',
        description: 'Clear the documentation cache to fetch fresh content.',
        inputSchema: { type: 'object', properties: {} },
      },
    ],
  }
})

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const { name, arguments: args } = request.params

    switch (name) {
      case 'fetch_docs': {
        const path = String(args?.path || '')
        const includeMetadata = args?.include_metadata !== false
        if (!path) throw new Error('Path is required')

        const doc = await fetchDocumentation(path)

        let response = `# ${doc.metadata.title}\n\n`
        if (includeMetadata && doc.metadata.description) {
          response += `**Description:** ${doc.metadata.description}\n\n`
        }
        if (includeMetadata && doc.metadata.url) {
          response += `**URL:** ${doc.metadata.url}\n\n`
        }
        if (includeMetadata && doc.metadata.apiEndpoints?.length) {
          response += `**API Endpoints found:**\n${doc.metadata.apiEndpoints.map((ep) => `- ${ep}`).join('\n')}\n\n`
        }

        response += `---\n\n${doc.markdown}\n\n`

        // ✅ Fix: actually print code examples
        if (includeMetadata && doc.metadata.codeExamples?.length) {
          response += `---\n\n**Code Examples (${doc.metadata.codeExamples.length}):**\n\n`
          for (const ex of doc.metadata.codeExamples.slice(0, 5)) {
            response += `\`\`\`\n${ex}\n\`\`\`\n\n`
          }
        }

        return { content: [{ type: 'text', text: response }] }
      }

      case 'list_pages': {
        const pages = await listPagesFromLlms()
        const text =
          pages.length === 0
            ? 'No pages found in llms.txt.'
            : `# Pages referenced in llms.txt\n\nFound ${pages.length} page(s):\n\n` +
              pages.map((p) => `- ${p}`).join('\n')
        return { content: [{ type: 'text', text }] }
      }

      case 'get_page_outline': {
        const path = String(args?.path || '')
        if (!path) throw new Error('Path is required')
        const doc = await fetchDocumentation(path)
        const headings = extractMarkdownHeadings(doc.markdown)

        const text =
          headings.length === 0
            ? `# Outline for ${doc.metadata.title}\n\n(No headings found.)`
            : `# Outline for ${doc.metadata.title}\n\n` +
              headings
                .map(
                  (h) => `${'  '.repeat(Math.max(0, h.level - 1))}- ${h.text}`,
                )
                .join('\n')

        return { content: [{ type: 'text', text }] }
      }

      case 'get_section': {
        const path = String(args?.path || '')
        const heading = String(args?.heading || '')
        if (!path) throw new Error('Path is required')
        if (!heading) throw new Error('Heading is required')

        const section = await getSectionFromPage(path, heading)
        if (!section) {
          return {
            content: [
              {
                type: 'text',
                text: `No section "${heading}" found on ${path}. Try get_page_outline first.`,
              },
            ],
          }
        }

        const text = `# ${section.title}\n\n**URL:** ${section.url}\n\n---\n\n${section.content}\n`
        return { content: [{ type: 'text', text }] }
      }

      case 'get_chunks': {
        const path = String(args?.path || '')
        const max = Number(args?.max_chunks ?? 20)
        if (!path) throw new Error('Path is required')

        const normalized = normalizePath(path)
        const chunks =
          normalized === '/llms.txt' || normalized === '/'
            ? await getLlmsChunks()
            : await getPageChunks(path)

        const sliced = chunks.slice(0, Math.max(1, Math.min(200, max)))
        const text =
          `# Chunks for ${path}\n\nReturned ${sliced.length} chunk(s).\n\n` +
          sliced
            .map(
              (c, i) =>
                `## ${i + 1}. ${c.heading}\n` +
                `- chunkId: ${c.id}\n` +
                `- lines: ${c.startLine}-${c.endLine}\n` +
                `- url: ${c.url}\n` +
                `\n${clampText(c.content, 1200)}\n`,
            )
            .join('\n')

        return {
          content: [
            { type: 'text', text: clampText(text, MAX_CONTENT_LENGTH) },
          ],
        }
      }

      case 'get_chunk': {
        const chunkId = String(args?.chunk_id || '')
        if (!chunkId) throw new Error('chunk_id is required')

        const chunk = await getChunkById(chunkId)
        if (!chunk) {
          return {
            content: [
              {
                type: 'text',
                text: `Chunk not found: ${chunkId}. Try search_docs or get_chunks first.`,
              },
            ],
          }
        }

        const text =
          `# ${chunk.title}\n\n` +
          `**Heading:** ${chunk.heading}\n\n` +
          `**URL:** ${chunk.url}\n\n` +
          `**Lines:** ${chunk.startLine}-${chunk.endLine}\n\n` +
          `---\n\n${clampText(chunk.content, MAX_CONTENT_LENGTH)}\n`

        return { content: [{ type: 'text', text }] }
      }

      case 'search_docs': {
        const query = String(args?.query || '').trim()
        const max = Number(args?.max_results ?? 10)
        if (!query) throw new Error('Query is required')

        const results = await searchDocumentation(
          query,
          Math.max(1, Math.min(20, max)),
        )

        if (results.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: `No results found for "${query}" in llms.txt chunks.`,
              },
            ],
          }
        }

        let text = `# Search Results for "${query}"\n\nFound ${results.length} result(s):\n\n`
        for (const [i, r] of results.entries()) {
          text +=
            `## ${i + 1}. ${r.heading}\n` +
            `- title: ${r.title}\n` +
            `- chunkId: ${r.chunkId}\n` +
            `- score: ${r.score}\n` +
            `- path: ${r.path}\n` +
            `- url: ${r.url}\n\n` +
            `**Snippet:** ${r.snippet}\n\n`
        }

        return {
          content: [
            { type: 'text', text: clampText(text, MAX_CONTENT_LENGTH) },
          ],
        }
      }

      case 'list_api_endpoints': {
        // Keep your best-effort extraction, but run against llms raw
        const endpoints = new Set<string>()
        const llmsTxt = await fetchLlmsTxtRaw()

        const patterns = [
          /(?:GET|POST|PUT|DELETE|PATCH)\s+([\/][a-zA-Z0-9\-\/_{}:]+)/g,
          /`(\/(?:api|v1|v2)[\/a-zA-Z0-9\-_{}:]+)`/g,
          /endpoint[:\s]+[`"']?([\/][a-zA-Z0-9\-\/_{}:]+)[`"']?/gi,
        ]

        for (const pattern of patterns) {
          let match: RegExpExecArray | null
          while ((match = pattern.exec(llmsTxt)) !== null) {
            const endpoint = match[1]
            if (endpoint && endpoint.length > 1) endpoints.add(endpoint)
          }
        }

        const list = Array.from(endpoints).sort()
        const text =
          list.length === 0
            ? '# Humanity Protocol API Endpoints\n\nNo API endpoints found in llms.txt.'
            : `# Humanity Protocol API Endpoints\n\nFound ${list.length} endpoint(s):\n\n` +
              list.map((e) => `- ${e}`).join('\n')

        return { content: [{ type: 'text', text }] }
      }

      case 'extract_code_examples': {
        const path = String(args?.path || '')
        if (!path) throw new Error('Path is required')

        const doc = await fetchDocumentation(path)
        const examples = doc.metadata.codeExamples || []

        let text = `# Code Examples from ${path}\n\n`
        if (examples.length === 0) {
          text += 'No code examples found on this page.\n'
        } else {
          text += `Found ${examples.length} code example(s):\n\n`
          examples.slice(0, 10).forEach((example, index) => {
            text += `## Example ${index + 1}\n\n\`\`\`\n${example}\n\`\`\`\n\n`
          })
        }

        return {
          content: [
            { type: 'text', text: clampText(text, MAX_CONTENT_LENGTH) },
          ],
        }
      }

      case 'generate_curl': {
        const method = String(args?.method || 'GET')
        const url = String(args?.url || '')
        if (!url) throw new Error('url is required')

        const headers = (args?.headers || {}) as Record<string, string>
        const query = (args?.query || {}) as Record<
          string,
          string | number | boolean
        >
        const jsonBody = args?.json_body

        const curl = generateCurl({ method, url, headers, query, jsonBody })
        const text = `# Generated curl\n\n\`\`\`bash\n${curl}\n\`\`\`\n`
        return { content: [{ type: 'text', text }] }
      }

      case 'clear_cache': {
        cache.flushAll()
        return {
          content: [
            { type: 'text', text: 'Documentation cache cleared successfully.' },
          ],
        }
      }

      default:
        throw new Error(`Unknown tool: ${name}`)
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    return {
      content: [{ type: 'text', text: `Error: ${errorMessage}` }],
      isError: true,
    }
  }
})

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('Humanity Protocol Docs MCP Server running on stdio (v2.0.0)')
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
