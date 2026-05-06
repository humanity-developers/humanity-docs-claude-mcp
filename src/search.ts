import { MAX_SEARCH_RESULTS, cache } from './config.js'
import type { Chunk, SearchResult } from './types.js'
import { scoreChunk, makeSnippet, clampText } from './utils.js'
import { getLlmsChunks, getPageChunks, fetchDocumentation } from './fetcher.js'

export async function searchDocumentation(
  query: string,
  maxResults = MAX_SEARCH_RESULTS,
  path?: string,
): Promise<SearchResult[]> {
  const q = query.trim()
  if (!q) return []

  const chunks = path ? await getPageChunks(path) : await getLlmsChunks()

  const scored = chunks
    .map((c) => ({ chunk: c, score: scoreChunk(c, q) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(20, maxResults * 3))

  const results: SearchResult[] = []
  const seen = new Set<string>()

  for (const s of scored) {
    const c = s.chunk
    const key = `${c.path}::${c.heading}`.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)

    results.push({
      title: c.title,
      url: c.url,
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

export async function getChunkById(chunkId: string): Promise<Chunk | null> {
  const llms = await getLlmsChunks()
  const foundLlms = llms.find((c) => c.id === chunkId)
  if (foundLlms) return foundLlms

  const keys = cache.keys().filter((k) => k.startsWith('chunks:'))
  for (const k of keys) {
    const chunks = cache.get<Chunk[]>(k)
    const found = chunks?.find((c) => c.id === chunkId)
    if (found) return found
  }
  return null
}

export async function getSectionFromPage(
  pathOrUrl: string,
  heading: string,
): Promise<{ url: string; title: string; heading: string; content: string } | null> {
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
    if (m[1].length <= startLevel) {
      end = i
      break
    }
  }

  const content = lines.slice(start, end).join('\n').trim()
  return {
    url: doc.metadata.url || '',
    title: doc.metadata.title,
    heading,
    content: clampText(content, 120_000),
  }
}
