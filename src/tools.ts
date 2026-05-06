export const toolDefinitions = [
  {
    name: 'fetch_docs',
    description:
      'Fetch documentation from docs.humanity.org. Use "/" or "/llms.txt" for comprehensive llms.txt. Use a specific path for individual pages. Scoped to docs.humanity.org — for individual pages, get the path from list_pages first.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        include_metadata: {
          type: 'boolean',
          default: true,
          description: 'Include API endpoints and code examples in the response (default: true)',
        },
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
      'Fetch only a specific section under a heading from a page. Heading must be an exact match (case-insensitive). Use get_page_outline first to see available headings.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Page path from list_pages',
        },
        heading: { type: 'string' },
      },
      required: ['path', 'heading'],
    },
  },
  {
    name: 'get_chunks',
    description:
      "Returns a list of chunks with IDs and line numbers for a page or llms.txt. Use get_chunk with a returned chunkId to retrieve specific content. Pass '/' or '/llms.txt' for the full docs corpus.",
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: "Page path from list_pages, or '/' for the full llms.txt corpus",
        },
        max_chunks: {
          type: 'number',
          default: 20,
          description: 'Maximum number of chunks to return (default: all)',
        },
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
      'Search documentation. Searches all docs by default. Pass a path to scope search to a single page. Results include a relevance score — higher is better, treat it as a relative ranking. Returns chunkIds so you can fetch exact supporting context.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        max_results: {
          type: 'number',
          default: 10,
          description: 'Number of results to return, 1–10 (default: 10)',
        },
        path: {
          type: 'string',
          description: 'Optional. Scope search to a single page path from list_pages.',
        },
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
      'Extract code examples from a specific documentation page. Note: fetch_docs already includes code examples in its response. Use this tool only when you want examples isolated without the full page content.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
  {
    name: 'generate_code_snippet',
    description:
      'Generate a ready-to-use code snippet for a Humanity API call. Supports curl, HTTP, JavaScript (fetch), and Python (requests). Defaults to curl. Content-Type: application/json is added automatically when json_body is provided.',
    inputSchema: {
      type: 'object',
      properties: {
        method: { type: 'string', description: 'HTTP method: GET, POST, PUT, DELETE, PATCH' },
        url: {
          type: 'string',
          description: 'Full URL including base (e.g. https://api.humanity.org/v2/userinfo)',
        },
        language: {
          type: 'string',
          enum: ['curl', 'http', 'javascript', 'python'],
          description: 'Output language (default: curl)',
        },
        headers: {
          type: 'object',
          description: 'Request headers as key-value pairs',
          additionalProperties: { type: 'string' },
        },
        query: {
          type: 'object',
          description: 'Query parameters as key-value pairs. Appended to the URL.',
          additionalProperties: { type: ['string', 'number', 'boolean'] },
        },
        json_body: {
          description:
            'JSON body for POST/PUT/PATCH. Accepts any JSON-serializable value. Content-Type: application/json is added automatically.',
        },
      },
      required: ['method', 'url'],
    },
  },
  {
    name: 'clear_cache',
    description:
      'Clear all cached documentation so the next request fetches live content from docs.humanity.org. Call this if the user reports stale or outdated content, or if you know docs have been recently updated.',
    inputSchema: { type: 'object', properties: {} },
  },
]
