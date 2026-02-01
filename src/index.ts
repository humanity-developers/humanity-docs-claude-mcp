#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fetch from "node-fetch";
import * as cheerio from "cheerio";
import NodeCache from "node-cache";
import TurndownService from "turndown";

// Configuration
const DOCS_BASE_URL = "https://docs.humanity.org";
const CACHE_TTL = 3600; // 1 hour
const MAX_CONTENT_LENGTH = 50000; // characters

// Initialize cache (1 hour TTL, check every 10 minutes)
const cache = new NodeCache({ stdTTL: CACHE_TTL, checkperiod: 600 });

// Initialize Turndown for HTML to Markdown conversion
const turndownService = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
});

interface DocMetadata {
  title: string;
  description?: string;
  apiEndpoints?: string[];
  codeExamples?: string[];
  lastFetched: Date;
}

interface CachedDoc {
  content: string;
  metadata: DocMetadata;
  markdown: string;
}

/**
 * Fetch and parse documentation from docs.humanity.org
 */
async function fetchDocumentation(path: string): Promise<CachedDoc> {
  // Check cache first
  const cacheKey = `doc:${path}`;
  const cached = cache.get<CachedDoc>(cacheKey);
  if (cached) {
    return cached;
  }

  const url = path.startsWith("http")
    ? path
    : `${DOCS_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);

  // Extract main content (adjust selectors based on your docs structure)
  // Common GitBook/documentation selectors
  const mainContent =
    $("article").html() ||
    $(".markdown-body").html() ||
    $("main").html() ||
    $(".content").html() ||
    $("body").html() ||
    "";

  // Extract metadata
  const title = $("h1").first().text() || $("title").text() || "Untitled";
  const description =
    $('meta[name="description"]').attr("content") ||
    $('meta[property="og:description"]').attr("content") ||
    "";

  // Extract API endpoints
  const apiEndpoints: string[] = [];
  $("code").each((_, el) => {
    const text = $(el).text();
    // Match common API endpoint patterns
    if (text.match(/^\/(api|v1|v2)\/[a-z0-9\-\/]+$/i)) {
      apiEndpoints.push(text);
    }
  });

  // Extract code examples
  const codeExamples: string[] = [];
  $("pre code, .code-block").each((_, el) => {
    const code = $(el).text().trim();
    if (code.length > 10 && code.length < 2000) {
      codeExamples.push(code);
    }
  });

  // Convert to markdown
  const markdown = turndownService.turndown(mainContent);

  // Truncate if too long
  let finalContent = markdown;
  if (finalContent.length > MAX_CONTENT_LENGTH) {
    finalContent = finalContent.substring(0, MAX_CONTENT_LENGTH) + "\n\n[Content truncated...]";
  }

  const result: CachedDoc = {
    content: mainContent,
    markdown: finalContent,
    metadata: {
      title,
      description,
      apiEndpoints: [...new Set(apiEndpoints)],
      codeExamples: codeExamples.slice(0, 5), // Keep top 5
      lastFetched: new Date(),
    },
  };

  // Cache the result
  cache.set(cacheKey, result);

  return result;
}

/**
 * Search documentation by crawling common paths
 */
async function searchDocumentation(query: string): Promise<Array<{ path: string; title: string; snippet: string }>> {
  // Common documentation paths to search
  const commonPaths = [
    "/",
    "/api",
    "/api/authentication",
    "/api/verification",
    "/sdk",
    "/getting-started",
    "/guides",
    "/reference",
    "/integration",
    "/quickstart",
  ];

  const results: Array<{ path: string; title: string; snippet: string }> = [];
  const searchLower = query.toLowerCase();

  for (const path of commonPaths) {
    try {
      const doc = await fetchDocumentation(path);
      const contentLower = doc.markdown.toLowerCase();

      if (
        contentLower.includes(searchLower) ||
        doc.metadata.title.toLowerCase().includes(searchLower)
      ) {
        // Find snippet around the query
        const index = contentLower.indexOf(searchLower);
        const start = Math.max(0, index - 100);
        const end = Math.min(doc.markdown.length, index + 200);
        const snippet = doc.markdown.substring(start, end).trim();

        results.push({
          path,
          title: doc.metadata.title,
          snippet: `...${snippet}...`,
        });
      }
    } catch (error) {
      // Skip paths that don't exist
      continue;
    }
  }

  return results;
}

/**
 * Get a list of all API endpoints from documentation
 */
async function listApiEndpoints(): Promise<string[]> {
  const apiPaths = ["/api", "/api/reference", "/reference/api"];
  const endpoints = new Set<string>();

  for (const path of apiPaths) {
    try {
      const doc = await fetchDocumentation(path);
      doc.metadata.apiEndpoints?.forEach((ep) => endpoints.add(ep));
    } catch (error) {
      continue;
    }
  }

  return Array.from(endpoints);
}

/**
 * Extract all code examples from a documentation page
 */
async function extractCodeExamples(path: string): Promise<string[]> {
  const doc = await fetchDocumentation(path);
  return doc.metadata.codeExamples || [];
}

// Create MCP server
const server = new Server(
  {
    name: "humanity-docs",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Define available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "fetch_docs",
        description:
          "Fetch documentation from docs.humanity.org. Returns formatted markdown with metadata including API endpoints and code examples.",
        inputSchema: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description:
                "Path to the documentation page (e.g., '/api/authentication', '/getting-started', or full URL)",
            },
            include_metadata: {
              type: "boolean",
              description: "Include metadata like API endpoints and code examples",
              default: true,
            },
          },
          required: ["path"],
        },
      },
      {
        name: "search_docs",
        description:
          "Search Humanity Protocol documentation for a specific query. Returns relevant pages with snippets.",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Search query (e.g., 'palm verification', 'authentication', 'SDK')",
            },
          },
          required: ["query"],
        },
      },
      {
        name: "list_api_endpoints",
        description: "Get a comprehensive list of all API endpoints documented in docs.humanity.org",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "extract_code_examples",
        description: "Extract all code examples from a specific documentation page",
        inputSchema: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Path to the documentation page",
            },
          },
          required: ["path"],
        },
      },
      {
        name: "clear_cache",
        description: "Clear the documentation cache to fetch fresh content",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
    ],
  };
});

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const { name, arguments: args } = request.params;

    switch (name) {
      case "fetch_docs": {
        const path = args?.path as string;
        const includeMetadata = args?.include_metadata !== false;

        if (!path) {
          throw new Error("Path is required");
        }

        const doc = await fetchDocumentation(path);

        let response = `# ${doc.metadata.title}\n\n`;

        if (includeMetadata && doc.metadata.description) {
          response += `**Description:** ${doc.metadata.description}\n\n`;
        }

        if (includeMetadata && doc.metadata.apiEndpoints && doc.metadata.apiEndpoints.length > 0) {
          response += `**API Endpoints found:**\n${doc.metadata.apiEndpoints.map((ep) => `- ${ep}`).join("\n")}\n\n`;
        }

        response += `---\n\n${doc.markdown}\n\n`;

        if (includeMetadata && doc.metadata.codeExamples && doc.metadata.codeExamples.length > 0) {
          response += `\n---\n\n**Code Examples (${doc.metadata.codeExamples.length}):**\n\n`;
        }

        return {
          content: [
            {
              type: "text",
              text: response,
            },
          ],
        };
      }

      case "search_docs": {
        const query = args?.query as string;

        if (!query) {
          throw new Error("Query is required");
        }

        const results = await searchDocumentation(query);

        if (results.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `No results found for "${query}" in Humanity Protocol documentation.`,
              },
            ],
          };
        }

        let response = `# Search Results for "${query}"\n\nFound ${results.length} result(s):\n\n`;

        results.forEach((result, index) => {
          response += `## ${index + 1}. ${result.title}\n`;
          response += `**Path:** ${result.path}\n`;
          response += `**Snippet:** ${result.snippet}\n\n`;
        });

        return {
          content: [
            {
              type: "text",
              text: response,
            },
          ],
        };
      }

      case "list_api_endpoints": {
        const endpoints = await listApiEndpoints();

        let response = "# Humanity Protocol API Endpoints\n\n";

        if (endpoints.length === 0) {
          response += "No API endpoints found in documentation.\n";
        } else {
          response += `Found ${endpoints.length} endpoint(s):\n\n`;
          endpoints.forEach((ep) => {
            response += `- ${ep}\n`;
          });
        }

        return {
          content: [
            {
              type: "text",
              text: response,
            },
          ],
        };
      }

      case "extract_code_examples": {
        const path = args?.path as string;

        if (!path) {
          throw new Error("Path is required");
        }

        const examples = await extractCodeExamples(path);

        let response = `# Code Examples from ${path}\n\n`;

        if (examples.length === 0) {
          response += "No code examples found on this page.\n";
        } else {
          response += `Found ${examples.length} code example(s):\n\n`;
          examples.forEach((example, index) => {
            response += `## Example ${index + 1}\n\n\`\`\`\n${example}\n\`\`\`\n\n`;
          });
        }

        return {
          content: [
            {
              type: "text",
              text: response,
            },
          ],
        };
      }

      case "clear_cache": {
        cache.flushAll();
        return {
          content: [
            {
              type: "text",
              text: "Documentation cache cleared successfully. Fresh content will be fetched on next request.",
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: `Error: ${errorMessage}`,
        },
      ],
      isError: true,
    };
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Humanity Protocol Docs MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
