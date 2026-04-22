import NodeCache from 'node-cache'
import TurndownService from 'turndown'

export const DOCS_BASE_URL = 'https://docs.humanity.org'
export const LLMS_TXT_URL = 'https://docs.humanity.org/llms.txt'
export const CACHE_TTL = 900 // 15 minutes (P1a)
export const MAX_CONTENT_LENGTH = 120_000
export const MAX_CHUNK_CHARS = 4000
export const MAX_SEARCH_RESULTS = 10

export const cache = new NodeCache({ stdTTL: CACHE_TTL, checkperiod: 600 })

export const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
})
