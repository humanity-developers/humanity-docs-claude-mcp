# Humanity Protocol Docs MCP Server

An MCP (Model Context Protocol) server that gives Claude Code live access to [docs.humanity.org](https://docs.humanity.org) while you build. Features intelligent chunk-based search with ranked results, precise content retrieval, section extraction, and automatic curl command generation — all directly within your Claude Code session.

> **How it works:** You do not need to run or manage the server manually. Once configured, Claude Code starts and stops it automatically as needed via stdio.

## ✨ Key Features (v2.0)

- **🔍 Smart Search** - Ranked search over comprehensive llms.txt with chunkIds for precise retrieval
- **📑 Chunk-Based Architecture** - Break down large docs into manageable, contextual pieces
- **🎯 Section Extraction** - Pull specific sections by heading without fetching entire pages
- **📋 Page Outlines** - See document structure before diving deep
- **⚡ cURL Generator** - Instantly create ready-to-run API commands with proper headers and payloads
- **🗂️ Smart Caching** - 1-hour TTL with automatic invalidation

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

## What's New in v2.0

### Major Improvements

**🔍 Intelligent Search Architecture**
- Upgraded from basic path crawling to ranked chunk-based search
- Search returns `chunkIds` for precise follow-up retrieval
- Scoring algorithm prioritizes heading matches and exact phrases
- Single fetch of llms.txt covers entire documentation

**📑 Chunk Management**
- Automatic document splitting by semantic boundaries (headings)
- Each chunk tracked with source location (line numbers)
- ~4000 character chunks optimized for LLM context windows
- Eliminates truncation issues with large docs

**🎯 Advanced Navigation**
- `get_section()` - Extract specific sections without loading entire pages
- `get_page_outline()` - Preview document structure before diving in
- `get_chunks()` - Explore all chunks for a page
- `get_chunk()` - Direct retrieval by chunkId

**⚡ Developer Tools**
- `generate_curl()` - Auto-generate ready-to-run API commands
- Supports headers, query params, and JSON payloads
- Proper escaping and formatting

**Performance**
- Increased cache limits (50K → 120K chars)
- Smarter caching strategy (separate chunk cache)
- Reduced redundant fetches with llms.txt-first approach

### Migration from v1.0

If you're upgrading:
1. Run `./setup.sh` to rebuild with new features
2. Clear your cache: ask Claude to `"Clear the docs cache"`
3. Your existing configuration doesn't need changes

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

| Variant | Linux | macOS |
|---|---|---|
| VS Code | `~/.config/Code/User/settings.json` | `~/Library/Application Support/Code/User/settings.json` |
| VS Code OSS | `~/.config/Code - OSS/User/settings.json` | — |
| VSCodium | `~/.config/VSCodium/User/settings.json` | `~/Library/Application Support/VSCodium/User/settings.json` |

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

You should see: `Humanity Protocol Docs MCP Server running on stdio (v2.0.0)`

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

| Tool | Purpose | Example Use Case |
|------|---------|------------------|
| `fetch_docs` | Get full documentation pages | "Show me the SDK overview" |
| `search_docs` | Ranked search with chunkIds | "Find palm verification docs" |
| `get_chunk` | Fetch precise chunk by ID | Follow-up after search |
| `get_chunks` | List all chunks for a page | Explore document structure |
| `get_section` | Extract specific heading section | "Get just the authentication section" |
| `get_page_outline` | View document headings | Navigate before fetching |
| `list_pages` | Discover available paths | "What pages exist in docs?" |
| `list_api_endpoints` | Extract API endpoints | "What endpoints are available?" |
| `extract_code_examples` | Pull code samples | "Get code examples from SDK page" |
| `generate_curl` | Create ready-to-run commands | "Make a curl for the verify endpoint" |
| `clear_cache` | Refresh cached content | "Clear cache and refetch" |

### Workflow Example

**User:** "Search for palm verification"

**Claude internally:**
1. Uses `search_docs("palm verification")` → gets ranked results with chunkIds
2. Uses `get_chunk(chunkId)` → retrieves exact context
3. Presents information to you with source references

**User:** "Now generate a curl command to test the verify endpoint"

**Claude internally:**
1. Uses `generate_curl({method: "POST", url: "...", json_body: {...}})`
2. Returns ready-to-run command with proper headers and payload

---

## Usage patterns

### Smart search with chunk retrieval

```
"Search for palm verification and show me the implementation details"
```

Claude will search across all documentation, rank results by relevance, and fetch the exact chunks containing palm verification information.

### Section-specific extraction

```
"Get just the authentication section from the SDK docs"
```

Claude will fetch the page outline, locate the authentication heading, and extract only that section — no need to load the entire page.

### Generate API commands

```
"Create a curl command to verify a user with their auth token"
```

Claude will look up the verification endpoint details and generate a properly formatted curl command with headers, auth, and example payload.

### Building an app

```
"Build a React application that uses the SDK to go through PKCE verification"
```

Claude will search for PKCE docs, extract code examples, and use them as context while building your app.

### Exploring scopes and presets

```
"Give me all available scopes and presets my application can request"
```

Claude will fetch the authentication documentation, extract scope definitions, and compile what's available for your application.

### Keeping up with doc changes

```
"The docs were just updated. Clear the cache and fetch the webhook page again."
```

---

## Configuration reference

The server caches fetched pages and chunks for one hour by default. These values can be adjusted in `src/index.ts`:

| Constant | Default | Description |
|---|---|---|
| `CACHE_TTL` | `3600` (1 hour) | How long fetched pages are cached, in seconds |
| `MAX_CONTENT_LENGTH` | `120000` | Maximum characters returned per response |
| `MAX_CHUNK_CHARS` | `4000` | Target size for each documentation chunk |
| `MAX_SEARCH_RESULTS` | `10` | Maximum results returned by search |
| `DOCS_BASE_URL` | `https://docs.humanity.org` | Base URL for the documentation site |
| `LLMS_TXT_URL` | `https://docs.humanity.org/llms.txt` | Primary source for comprehensive docs |

### Architecture Notes

**Chunk-based design:** Documents are automatically split by headings into chunks of ~4000 characters. This enables:
- Precise retrieval via chunkId references
- Better context management for LLMs
- Faster searches (no need to scan full pages)
- Line number tracking for exact source locations

**Search algorithm:** Uses term frequency scoring with heading preference (8x weight for heading matches, 2x for body matches). Exact phrase matches receive bonus points.

---

## Troubleshooting

**Server doesn't appear in `/mcp`**
Verify the path in your configuration is absolute. Run `pwd` inside `humanity-docs-mcp` and confirm `dist/index.js` exists at that location. Fully close and reopen your editor after any config change.

**"Request failed with status code 404"**
The path you're requesting doesn't exist on docs.humanity.org. Try searching first to find valid paths, or fetch the root page (`/`) to see what's available.

**Stale content after a doc update**
Ask Claude to clear the cache: `"Clear the docs cache"`. The next fetch will pull fresh content.

**Content appears truncated**
Increase `MAX_CONTENT_LENGTH` in `src/index.ts` and rebuild with `npm run build`.

---

## Project structure

```
humanity-docs-mcp/
├── src/
│   └── index.ts          # MCP server implementation
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
