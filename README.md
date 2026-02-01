# Humanity Protocol Docs MCP Server

An MCP (Model Context Protocol) server that gives Claude Code live access to [docs.humanity.org](https://docs.humanity.org) while you build. Fetch documentation, search across pages, discover API endpoints, and extract code examples — all directly within your Claude Code session.

> **How it works:** You do not need to run or manage the server manually. Once configured, Claude Code starts and stops it automatically as needed via stdio.

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

You should see: `Humanity Protocol Docs MCP Server running on stdio`

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

Claude will internally fetch the relevant SDK and authentication documentation, extract code examples, and use all of that as context while writing your app. You won't see any of that happening — it just works.

The server has five capabilities it can use behind the scenes: fetching specific pages, searching across the documentation, listing API endpoints, extracting code examples, and clearing its cache when docs have been updated. Claude decides which of these to use based on what you're asking for.

The only time you'd explicitly mention the server is if you want to force a cache refresh after a doc update:

```
"The docs were just updated. Clear the cache and fetch the webhook page again."
```

---

## Usage patterns

### Building an app

```
"Build a React application that uses the SDK to go through PKCE verification"
```

Claude will pull the SDK and PKCE verification docs, extract relevant code examples, and use them as context while building the app.

### Exploring scopes and presets

```
"Give me all available scopes and presets my application can request"
```

Claude will fetch the authentication and scopes documentation and compile what's available for your application.

### Working with user profiles

```
"Give me examples on how to use the SDK to fetch a user profile via presets"
```

Claude will pull the SDK docs and any preset-related examples, then put together working code for you.

### Keeping up with doc changes

```
"The docs were just updated. Clear the cache and fetch the webhook page again."
```

---

## Configuration reference

The server caches fetched pages for one hour by default. These values can be adjusted in `src/index.ts`:

| Constant | Default | Description |
|---|---|---|
| `CACHE_TTL` | `3600` (1 hour) | How long fetched pages are cached, in seconds |
| `MAX_CONTENT_LENGTH` | `50000` | Maximum characters returned per page before truncation |
| `DOCS_BASE_URL` | `https://docs.humanity.org` | Base URL for the documentation site |

The `commonPaths` array in `searchDocumentation` controls which pages are included in search. Add or remove paths there to match your documentation structure.

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
