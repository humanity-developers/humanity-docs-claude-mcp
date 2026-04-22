import { DOCS_BASE_URL, MAX_CHUNK_CHARS } from './config.js'
import type { Heading, Chunk } from './types.js'

export function normalizePath(path: string): string {
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

export function toAbsoluteUrl(pathOrUrl: string): string {
  if (!pathOrUrl) return DOCS_BASE_URL
  if (pathOrUrl.startsWith('http')) return pathOrUrl
  const p = normalizePath(pathOrUrl)
  return `${DOCS_BASE_URL}${p}`
}

export function clampText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen) + '\n\n[Content truncated...]'
}

export function safeId(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 120)
}

export function extractMarkdownHeadings(markdown: string): Heading[] {
  const lines = markdown.split('\n')
  const headings: Heading[] = []
  for (const line of lines) {
    const m = line.match(/^(#{1,6})\s+(.+?)\s*$/)
    if (m) headings.push({ level: m[1].length, text: m[2].trim() })
  }
  return headings
}

export function extractCodeBlocks(markdownOrText: string, limit = 10): string[] {
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

export function chunkMarkdown(opts: {
  markdown: string
  source: 'llms' | 'page'
  url: string
  path: string
  title: string
}): Chunk[] {
  const { markdown, source, url, path, title } = opts
  const lines = markdown.split('\n')

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

  const chunks: Chunk[] = []
  for (const s of sections) {
    const full = s.contentLines.join('\n').trim()
    if (!full) continue

    if (full.length <= MAX_CHUNK_CHARS) {
      const id = safeId(`${source}:${path}:${s.heading}:${s.startLine}-${s.endLine}`)
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

export function makeSnippet(text: string, q: string, max = 260): string {
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

// P3 fix: phrase bonus is outside the per-term loop so it fires exactly once
export function scoreChunk(chunk: Chunk, query: string): number {
  const q = query.toLowerCase().trim()
  if (!q) return 0
  const terms = q.split(/\s+/).filter(Boolean)
  const heading = `${chunk.title} ${chunk.heading}`.toLowerCase()
  const body = chunk.content.toLowerCase()

  let score = 0
  for (const term of terms) {
    const hCount = (
      heading.match(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []
    ).length
    const bCount = (
      body.match(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []
    ).length
    score += hCount * 8
    score += bCount * 2
  }

  if (q.length > 3 && heading.includes(q)) score += 10
  if (q.length > 3 && body.includes(q)) score += 6

  if (chunk.content.length < 2000) score += 1

  return score
}

// P1b / P7: human-readable cache staleness footer appended to tool responses
export function cacheFooter(lastFetched: Date): string {
  const diffMs = Date.now() - lastFetched.getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  const age = diffMin < 1 ? 'just now' : `${diffMin} min ago`
  return `\n---\n_Content cached at ${lastFetched.toISOString()} (${age}) · Call clear_cache to refresh_`
}
