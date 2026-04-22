<p align="center">
  <img src="https://cdn.humanity.org/humanity-protocol-logo-devs.png" width="576" alt="Humanity Protocol">
</p>

<h1 align="center">Humanity Protocol Docs MCP Server</h1>

<p align="center">
  <strong>An MCP (Model Context Protocol) server that gives Claude Code live access to <a href="https://docs.humanity.org" target="_blanck"  rel="noreferrer noopener">Humanity documentation</a> while you build.</strong>
</p>

<p align="center">
  <a href="https://docs.humanity.org"><img src="https://img.shields.io/badge/docs-humanity.org-blue.svg" alt="Documentation"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green.svg" alt="License"></a>
  <a href="https://discord.gg/humanity"><img src="https://img.shields.io/badge/discord-join-7289da.svg" alt="Discord"></a>
</p>

---

> **How it works:** You do not need to run or manage the server manually. Once configured, Claude Code starts and stops it automatically as needed via stdio.

## ✨ Key Features (v3.0)

- **🔍 Smart Search** - Ranked search over comprehensive llms.txt with chunkIds for precise retrieval. Scope search to a single page with an optional `path` parameter.
- **📑 Chunk-Based Architecture** - Break down large docs into manageable, contextual pieces
- **🎯 Section Extraction** - Pull specific sections by heading without fetching entire pages
- **📋 Page Outlines** - See document structure before diving deep
- **⚡ Multi-Language Snippet Generator** - Generate ready-to-run API commands in curl, HTTP, JavaScript, or Python
- **🗂️ Smart Caching** - 15-minute TTL with staleness timestamps on every response
- **🛡️ Reliable Fetching** - 10-second timeout on all outbound requests with clear error messages

---

## Quick Start

### 1. Build and configure

```bash
cd humanity-docs-mcp
./setup.sh
```

This checks your Node.js version, installs dependencies, builds the server, and prints the exact command you need to run next — with your path already filled in.

### 2. Register it with Claude Code

Run the `claude mcp add` command that `setup.sh` printed for you. It looks like this:

```bash
claude mcp add humanity-docs --scope user node /your/path/to/humanity-docs-mcp/dist/index.js
```

### 3. Verify the connection

Open Claude Code and run:

```
/mcp
```

You should see:

```
humanity-docs · ✓ connected
```

### 4. Try it out

```
"Fetch the main documentation page from docs.humanity.org"
"Search our docs for authentication"
"List all API endpoints"
```

### Uninstalling

```bash
claude mcp remove humanity-docs
```

---

## What's New in v3.0

### Modular Architecture

The entire server has been refactored from a single 1073-line file into focused modules, each independently navigable and editable:

```
src/
├── config.ts     # Constants, cache instance, Turndown init
├── types.ts      # DocMetadata, CachedDoc, Chunk, SearchResult
├── utils.ts      # Text helpers, chunking, scoring, cache footer
├── fetcher.ts    # All outbound HTTP and caching logic
├── search.ts     # Search, chunk lookup, section extraction
├── curl.ts       # Multi-language snippet generator
├── tools.ts      # MCP tool definitions and descriptions
└── index.ts      # Server init and request dispatch
```

### Reliability Improvements

**Fetch timeouts** — All outbound requests to docs.humanity.org now have a 10-second `AbortController` timeout. Previously a slow or unreachable server would hang indefinitely with no feedback. Failed requests now return a clear error: `"Request timed out after 10s — docs.humanity.org may be unavailable."`

**Search scoring fix** — The exact-phrase bonus in the ranking algorithm was firing once per search term instead of once per query, inflating scores for multi-word queries. Fixed: phrase bonus now runs exactly once after the per-term scoring loop.

### Cache & Freshness

**15-minute TTL** — Reduced from 1 hour to 15 minutes so doc updates surface faster within a session.

**Staleness footer** — Every tool response that draws from the cache now appends a footer showing when the content was fetched and how old it is:

```
---
_Content cached at 2026-04-22T10:15:00Z (4 min ago) · Call clear_cache to refresh_
```

**Improved `clear_cache` description** — Claude now knows to call `clear_cache` proactively when the user mentions stale content or recent doc updates.

### Multi-Language Snippet Generator

`generate_curl` has been replaced by `generate_code_snippet`, which supports four output formats via a `language` parameter:

| Language       | Output style              |
| -------------- | ------------------------- |
| `curl`         | `curl -sS -X ...` (default) |
| `http`         | Raw HTTP/1.1 request      |
| `javascript`   | `fetch()` with async/await |
| `python`       | `requests` library        |

`Content-Type: application/json` is injected automatically when `json_body` is provided. The previous double-stringify bug on the curl body has also been fixed.

### Scoped Page Search

`search_docs` now accepts an optional `path` parameter. Without it, search runs over the full llms.txt corpus as before. With it, search is scoped to the chunks of a single page — useful when working within one integration path.

### Improved Tool Descriptions

All tool and parameter descriptions have been rewritten to reduce silent failures:

- `get_section` now notes that heading must be an exact (case-insensitive) match and suggests `get_page_outline` first
- `get_chunks` clarifies how to use returned chunkIds and how to access the full corpus
- `fetch_docs` mentions it is scoped to docs.humanity.org and to use `list_pages` first
- `extract_code_examples` notes that `fetch_docs` already includes code examples
- `search_docs` explains that the score field is a relative ranking

### Migration from v2.0

1. Run `./setup.sh` to rebuild
2. No configuration changes needed
3. Note that `generate_curl` has been renamed to `generate_code_snippet` — update any saved prompts that reference it by name

---

## If `claude mcp add` doesn't work

The `claude mcp add` command writes to `~/.claude.json` and is the simplest path. If it doesn't work in your environment, you can register the server manually by editing your Claude Code configuration file directly.

The configuration block you need to add looks like this:

```json
{
  "mcpServers": {
    "humanity-docs": {
      "command": "node",
      "args": ["/absolute/path/to/humanity-docs-mcp/dist/index.js"]
    }
  }
}
```

Where to add it depends on your setup:

**Claude Code CLI** — edit `~/.claude.json`. Add the `mcpServers` block at the top level of the JSON, inside the root `{}`.

**VS Code / VS Code OSS / VSCodium** — the configuration file location varies depending on your OS and which variant you're using:

| Variant     | Linux                                     | macOS                                                       |
| ----------- | ----------------------------------------- | ----------------------------------------------------------- |
| VS Code     | `~/.config/Code/User/settings.json`       | `~/Library/Application Support/Code/User/settings.json`     |
| VS Code OSS | `~/.config/Code - OSS/User/settings.json` | —                                                           |
| VSCodium    | `~/.config/VSCodium/User/settings.json`   | `~/Library/Application Support/VSCodium/User/settings.json` |

If you're not sure which one applies, run this to find it:

```bash
# Linux / macOS
find ~/.config -name "settings.json" 2>/dev/null | grep -i code

# macOS (if the above returns nothing)
find ~/Library -name "settings.json" 2>/dev/null | grep -i code
```

Once you find the file, add this block alongside your other `claudeCode.*` settings:

```json
"claudeCode.mcpServers": {
  "humanity-docs": {
    "command": "node",
    "args": ["/absolute/path/to/humanity-docs-mcp/dist/index.js"]
  }
}
```

Make sure to use an **absolute path** — not relative (`./`) or shorthand (`~/`).

After editing, fully close and reopen your editor. Then run `/mcp` in Claude Code to confirm the server is connected.

For further reference on Claude Code MCP configuration, see: [https://code.claude.com/docs/en/mcp](https://code.claude.com/docs/en/mcp)

---

## Verifying the server works independently

If the server doesn't connect, you can verify it runs on its own:

```bash
cd humanity-docs-mcp
node dist/index.js
```

You should see: `Humanity Protocol Docs MCP Server running on stdio (v3.0.0)`

If you see this, the server itself is fine — the issue is with the configuration. Press `Ctrl+C` to stop it. You do **not** need to keep this running; it was just a verification step.

If you don't see it, rebuild:

```bash
npm install
npm run build
```

---

## How it works behind the scenes

You don't interact with the server directly. You just talk to Claude as you normally would. When Claude determines it needs documentation to help you, it pulls from docs.humanity.org automatically before responding.

For example, if you say:

```
"Build a React app that uses the SDK to authenticate email from a user"
```

Claude will internally fetch the relevant SDK and authentication documentation, extract code examples, and use all of that as context while building your app. You won't see any of that happening — it just works.

### Available Tools

The server provides 11 specialized tools that Claude uses intelligently based on your needs:

| Tool                     | Purpose                                    | Example Use Case                           |
| ------------------------ | ------------------------------------------ | ------------------------------------------ |
| `fetch_docs`             | Get full documentation pages               | "Show me the SDK overview"                 |
| `search_docs`            | Ranked search, optionally scoped to a page | "Find palm verification docs"              |
| `get_chunk`              | Fetch precise chunk by ID                  | Follow-up after search                     |
| `get_chunks`             | List all chunks for a page or corpus       | Explore document structure                 |
| `get_section`            | Extract specific heading section           | "Get just the authentication section"      |
| `get_page_outline`       | View document headings                     | Navigate before fetching                   |
| `list_pages`             | Discover available paths                   | "What pages exist in docs?"                |
| `list_api_endpoints`     | Extract API endpoints                      | "What endpoints are available?"            |
| `extract_code_examples`  | Pull code samples only                     | "Get code examples from SDK page"          |
| `generate_code_snippet`  | Create API commands in 4 languages         | "Make a curl for the verify endpoint"      |
| `clear_cache`            | Refresh cached content                     | "Clear cache and refetch"                  |

### Workflow Example

**User:** "Search for palm verification"

**Claude internally:**

1. Uses `search_docs("palm verification")` → gets ranked results with chunkIds
2. Uses `get_chunk(chunkId)` → retrieves exact context
3. Presents information to you with source references

**User:** "Now generate a Python snippet to test the verify endpoint"

**Claude internally:**

1. Uses `generate_code_snippet({method: "POST", url: "...", language: "python", json_body: {...}})`
2. Returns ready-to-run Python code with proper headers and payload

---

## Usage patterns

### Smart search with chunk retrieval

```
"Search for palm verification and show me the implementation details"
```

Claude will search across all documentation, rank results by relevance, and fetch the exact chunks containing palm verification information.

### Scoped search within a page

```
"Search for 'token expiry' only within the authentication page"
```

Claude will scope the search to that page's chunks, returning results without noise from unrelated sections.

### Section-specific extraction

```
"Get just the authentication section from the SDK docs"
```

Claude will fetch the page outline, locate the authentication heading, and extract only that section — no need to load the entire page.

### Generate API commands in any language

```
"Create a curl command to verify a user with their auth token"
"Give me the same as a Python snippet"
"Show me the JavaScript fetch version"
```

Claude will look up the endpoint details and generate a properly formatted snippet in your preferred language.

### Building an app

```
"Build a React application that uses the SDK to go through PKCE verification"
```

Claude will search for PKCE docs, extract code examples, and use them as context while building your app.

### Keeping up with doc changes

```
"The docs were just updated. Clear the cache and fetch the webhook page again."
```

Or simply wait — the cache expires automatically every 15 minutes.

---

## Configuration reference

Constants are defined in `src/config.ts`. Edit them and rebuild with `npm run build` to apply changes.

| Constant             | Default                              | Description                                   |
| -------------------- | ------------------------------------ | --------------------------------------------- |
| `CACHE_TTL`          | `900` (15 minutes)                   | How long fetched pages are cached, in seconds |
| `MAX_CONTENT_LENGTH` | `120000`                             | Maximum characters returned per response      |
| `MAX_CHUNK_CHARS`    | `4000`                               | Target size for each documentation chunk      |
| `MAX_SEARCH_RESULTS` | `10`                                 | Maximum results returned by search            |
| `DOCS_BASE_URL`      | `https://docs.humanity.org`          | Base URL for the documentation site           |
| `LLMS_TXT_URL`       | `https://docs.humanity.org/llms.txt` | Primary source for comprehensive docs         |

### Architecture Notes

**Chunk-based design:** Documents are automatically split by headings into chunks of ~4000 characters. This enables:

- Precise retrieval via chunkId references
- Better context management for LLMs
- Faster searches (no need to scan full pages)
- Line number tracking for exact source locations

**Search algorithm:** Uses term frequency scoring with heading preference (8x weight for heading matches, 2x for body matches). Exact phrase matches receive a one-time bonus after the per-term scoring pass.

**Fetch reliability:** All HTTP requests use a 10-second `AbortController` timeout. If docs.humanity.org is unreachable, tools fail fast with a clear message rather than hanging.

---

## Troubleshooting

**Server doesn't appear in `/mcp`**
Verify the path in your configuration is absolute. Run `pwd` inside `humanity-docs-mcp` and confirm `dist/index.js` exists at that location. Fully close and reopen your editor after any config change.

**"Request failed with status code 404"**
The path you're requesting doesn't exist on docs.humanity.org. Try searching first to find valid paths, or fetch the root page (`/`) to see what's available.

**"Request timed out after 10s"**
docs.humanity.org is unreachable or slow. Check your network connection and try again. If it persists, the site may be temporarily unavailable.

**Stale content after a doc update**
Ask Claude to clear the cache: `"Clear the docs cache"`. The cache also expires automatically every 15 minutes. Every response includes a footer showing the cached timestamp so you can judge freshness at a glance.

**Content appears truncated**
Increase `MAX_CONTENT_LENGTH` in `src/config.ts` and rebuild with `npm run build`.

---

## Project structure

```
humanity-docs-mcp/
├── src/
│   ├── config.ts          # Constants, cache, Turndown
│   ├── types.ts           # Shared TypeScript types
│   ├── utils.ts           # Text helpers, chunking, scoring
│   ├── fetcher.ts         # HTTP fetching and caching
│   ├── search.ts          # Search and retrieval logic
│   ├── curl.ts            # Multi-language snippet generator
│   ├── tools.ts           # MCP tool definitions
│   └── index.ts           # Server init and dispatch
├── dist/                  # Compiled output (generated by npm run build)
│   └── index.js
├── package.json
├── tsconfig.json
├── setup.sh               # Automated build + verification script
├── test.mjs               # Standalone connectivity tests
└── README.md
```

## Development

```bash
npm run build    # Build once
npm run dev      # Watch mode — rebuilds on file changes
npm test         # Run connectivity tests against docs.humanity.org
```

---

## License

MIT
