import fetch from 'node-fetch'
import * as cheerio from 'cheerio'
import {
  DOCS_BASE_URL,
  LLMS_TXT_URL,
  MAX_CONTENT_LENGTH,
  cache,
  turndownService,
} from './config.js'
import type { CachedDoc, Chunk } from './types.js'
import {
  normalizePath,
  toAbsoluteUrl,
  clampText,
  chunkMarkdown,
  extractCodeBlocks,
} from './utils.js'

// P2: 10s timeout on all outbound fetches
async function fetchWithTimeout(url: string): Promise<import('node-fetch').Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  try {
    const response = await fetch(url, { signal: controller.signal as never })
    return response
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Request timed out after 10s — docs.humanity.org may be unavailable.`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

export async function fetchLlmsTxtRaw(): Promise<string> {
  const cacheKey = 'llms-txt:raw'
  const cached = cache.get<{ raw: string }>(cacheKey)
  if (cached) return cached.raw

  const response = await fetchWithTimeout(LLMS_TXT_URL)
  if (!response.ok) {
    throw new Error(`Failed to fetch llms.txt: ${response.status} ${response.statusText}`)
  }
  const raw = await response.text()
  cache.set(cacheKey, { raw })
  cache.set('llms-txt:fetchedAt', new Date()) // P1b: track fetch time for cache footer
  return raw
}

export async function getLlmsChunks(): Promise<Chunk[]> {
  const cacheKey = 'llms-txt:chunks'
  const cached = cache.get<Chunk[]>(cacheKey)
  if (cached) return cached

  const raw = await fetchLlmsTxtRaw()
  const titleMatch = raw.match(/^#\s+(.+)$/m)
  const title = titleMatch ? titleMatch[1].trim() : 'Humanity Protocol Documentation'
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

export async function fetchDocumentation(pathOrUrl: string): Promise<CachedDoc> {
  const path = normalizePath(pathOrUrl)
  const cacheKey = `doc:${path}`
  const cached = cache.get<CachedDoc>(cacheKey)
  if (cached) return cached

  if (path === '/' || path === '/llms.txt') {
    const llmsTxt = await fetchLlmsTxtRaw()
    const titleMatch = llmsTxt.match(/^#\s+(.+)$/m)
    const title = titleMatch ? titleMatch[1].trim() : 'Humanity Protocol Documentation'
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
  const response = await fetchWithTimeout(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`)
  }

  const html = await response.text()
  const $ = cheerio.load(html)

  const mainContent =
    $('article').first().html() ||
    $('main').first().html() ||
    $('.markdown-body').first().html() ||
    $('.content').first().html() ||
    ''

  const title =
    $('h1').first().text().trim() || $('title').text().trim() || 'Untitled'
  const description =
    $('meta[name="description"]').attr('content') ||
    $('meta[property="og:description"]').attr('content') ||
    ''

  const apiEndpoints: string[] = []
  $('code').each((_, el) => {
    const text = $(el).text().trim()
    if (text.match(/^\/(api|v1|v2)\/[a-z0-9\-\/_{}:]+$/i)) apiEndpoints.push(text)
  })

  const codeExamples: string[] = []
  $('pre code, .code-block code, pre').each((_, el) => {
    const code = $(el).text().trim()
    if (code.length > 10 && code.length < 4000) codeExamples.push(code)
  })

  const markdown = turndownService.turndown(mainContent || $('body').html() || '')
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

export async function getPageChunks(pathOrUrl: string): Promise<Chunk[]> {
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

export async function listPagesFromLlms(): Promise<string[]> {
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
      // ignore malformed URLs
    }
  }

  const pages = Array.from(urls).sort()
  cache.set(cacheKey, pages)
  return pages
}
