export interface DocMetadata {
  title: string
  description?: string
  apiEndpoints?: string[]
  codeExamples?: string[]
  lastFetched: Date
  url?: string
}

export interface CachedDoc {
  content: string
  markdown: string
  metadata: DocMetadata
}

export type Heading = {
  level: number
  text: string
}

export type Chunk = {
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

export type SearchResult = {
  title: string
  url: string
  path: string
  heading: string
  chunkId: string
  score: number
  snippet: string
}
