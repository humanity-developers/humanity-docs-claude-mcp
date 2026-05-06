#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

import { cache } from './config.js'
import type { CachedDoc } from './types.js'
import {
  normalizePath,
  extractMarkdownHeadings,
  clampText,
  cacheFooter,
} from './utils.js'
import {
  fetchDocumentation,
  getLlmsChunks,
  getPageChunks,
  listPagesFromLlms,
  fetchLlmsTxtRaw,
} from './fetcher.js'
import { searchDocumentation, getChunkById, getSectionFromPage } from './search.js'
import { generateCodeSnippet } from './curl.js'
import { toolDefinitions } from './tools.js'

const MAX_CONTENT_LENGTH = 120_000

const server = new Server(
  { name: 'humanity-docs', version: '3.0.0' },
  { capabilities: { tools: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: toolDefinitions }
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

        if (includeMetadata && doc.metadata.codeExamples?.length) {
          response += `---\n\n**Code Examples (${doc.metadata.codeExamples.length}):**\n\n`
          for (const ex of doc.metadata.codeExamples.slice(0, 5)) {
            response += `\`\`\`\n${ex}\n\`\`\`\n\n`
          }
        }

        response += cacheFooter(doc.metadata.lastFetched)

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
                .map((h) => `${'  '.repeat(Math.max(0, h.level - 1))}- ${h.text}`)
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

        const cachedDoc = cache.get<CachedDoc>(`doc:${normalizePath(path)}`)
        const lastFetched = cachedDoc?.metadata.lastFetched

        let text = `# ${section.title}\n\n**URL:** ${section.url}\n\n---\n\n${section.content}\n`
        if (lastFetched) text += cacheFooter(lastFetched)

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
        let text =
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

        const lastFetched =
          normalized === '/llms.txt' || normalized === '/'
            ? cache.get<Date>('llms-txt:fetchedAt')
            : cache.get<CachedDoc>(`doc:${normalized}`)?.metadata.lastFetched
        if (lastFetched) text += cacheFooter(lastFetched)

        return {
          content: [{ type: 'text', text: clampText(text, MAX_CONTENT_LENGTH) }],
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

        let text =
          `# ${chunk.title}\n\n` +
          `**Heading:** ${chunk.heading}\n\n` +
          `**URL:** ${chunk.url}\n\n` +
          `**Lines:** ${chunk.startLine}-${chunk.endLine}\n\n` +
          `---\n\n${clampText(chunk.content, MAX_CONTENT_LENGTH)}\n`

        const lastFetched =
          chunk.source === 'llms'
            ? cache.get<Date>('llms-txt:fetchedAt')
            : cache.get<CachedDoc>(`doc:${chunk.path}`)?.metadata.lastFetched
        if (lastFetched) text += cacheFooter(lastFetched)

        return { content: [{ type: 'text', text }] }
      }

      case 'search_docs': {
        const query = String(args?.query || '').trim()
        const max = Number(args?.max_results ?? 10)
        const path = args?.path ? String(args.path) : undefined
        if (!query) throw new Error('Query is required')

        const results = await searchDocumentation(query, Math.max(1, Math.min(20, max)), path)

        if (results.length === 0) {
          const scope = path ? `page ${path}` : 'llms.txt chunks'
          return {
            content: [
              {
                type: 'text',
                text: `No results found for "${query}" in ${scope}.`,
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

        const lastFetched = path
          ? cache.get<CachedDoc>(`doc:${normalizePath(path)}`)?.metadata.lastFetched
          : cache.get<Date>('llms-txt:fetchedAt')
        if (lastFetched) text += cacheFooter(lastFetched)

        return {
          content: [{ type: 'text', text: clampText(text, MAX_CONTENT_LENGTH) }],
        }
      }

      case 'list_api_endpoints': {
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
          content: [{ type: 'text', text: clampText(text, MAX_CONTENT_LENGTH) }],
        }
      }

      case 'generate_code_snippet': {
        const method = String(args?.method || 'GET')
        const url = String(args?.url || '')
        if (!url) throw new Error('url is required')

        const lang = String(args?.language || 'curl')
        const headers = (args?.headers || {}) as Record<string, string>
        const query = (args?.query || {}) as Record<string, string | number | boolean>
        const jsonBody = args?.json_body

        const langLabels: Record<string, string> = {
          curl: 'bash',
          http: 'http',
          javascript: 'javascript',
          python: 'python',
        }
        const fenceLabel = langLabels[lang] ?? 'bash'

        const snippet = generateCodeSnippet(lang, { method, url, headers, query, jsonBody })
        const text = `# Generated ${lang} snippet\n\n\`\`\`${fenceLabel}\n${snippet}\n\`\`\`\n`
        return { content: [{ type: 'text', text }] }
      }

      case 'clear_cache': {
        cache.flushAll()
        return {
          content: [{ type: 'text', text: 'Documentation cache cleared successfully.' }],
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
  console.error('Humanity Protocol Docs MCP Server running on stdio (v3.0.0)')
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
