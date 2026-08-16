# webmesh-mcp

A token-economical web browsing, scraping, and crawling suite delivered as a
standard [MCP](https://modelcontextprotocol.io/) server. Any MCP-capable agent
(Claude, Cursor, Cline, etc.) can use it as ordinary tools with no bespoke
integration.

## Why this is cheaper than a full browser loop

| Strategy | Saving |
|---|---|
| **Tiered fetching** — static HTTP first, browser only when HTML is thin | Skips Chromium entirely for the majority of pages |
| **Markdown output, not raw HTML** — noise/nav/ads stripped server-side | 300 KB page → ~8 KB of clean markdown |
| **Schema extraction** — field → CSS selector returns only the values you asked for | No markdown conversion, no LLM reasoning |
| **Boolean verification** — `web_check` / `web_diff` never send back full page content | `pass: true` + 200-char evidence snippet |
| **ARIA snapshot over screenshot** — `web_interact` returns the accessibility tree | Image tokens only when you explicitly ask |
| **Persistent browser pool** — one Chromium process per server lifetime | ~1-2 s launch cost paid once, not per call |
| **robots.txt + rate limiting** — per-host queues and rule caching | Polite crawling without throttling your agent |

---

## Tools

| Tool | What it does | Browser needed? |
|---|---|---|
| `web_scrape` | Fetch a URL → clean markdown or schema-based JSON | Only if JS-rendered |
| `web_check` | Assert text/element present or absent → `pass: bool` + evidence | Only if JS-rendered |
| `web_diff` | Has this page changed since last check? → `changed: bool` + snippet | Only if JS-rendered |
| `web_interact` | Click / fill / select / press / waitFor sequence → ARIA snapshot | Always |
| `web_session_close` | Delete persisted cookies for a `sessionId` | No |
| `web_crawl` | BFS crawl from a seed URL → titles, links, excerpts, cached markdown | Only if JS-rendered |
| `web_crawl_get_page` | Retrieve full markdown cached by a prior `web_crawl` call | No |

---

## Installation

```bash
npm install -g webmesh-mcp
# or use directly with npx (no global install needed):
npx webmesh-mcp
```

### Chromium (optional — only needed for JS-rendered pages)

`webmesh-mcp` uses [`playwright-core`](https://www.npmjs.com/package/playwright-core)
and does **not** bundle a browser. You have three options:

**A) Install Playwright's managed Chromium** (simplest):
```bash
npx playwright install chromium
```

**B) Use your system Chrome / Edge** — set `executablePath` in your MCP config (see below).

**C) Connect to a running browser** — Playwright supports CDP attach; pass `--cdp-endpoint`
flags in `args` if you want to hook into an already-running instance.

Static pages (most blogs, docs, GitHub, npm, etc.) never trigger the browser path at all.

---

## Connecting to your agent

Add to your MCP config (e.g. `~/.claude/claude_desktop_config.json`, `.cursor/mcp.json`, etc.):

```json
{
  "mcpServers": {
    "web-agent": {
      "command": "npx",
      "args": ["webmesh-mcp"]
    }
  }
}
```

Or, if you prefer to run from source:

```json
{
  "mcpServers": {
    "web-agent": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/webmesh-mcp/src/index.ts"]
    }
  }
}
```

---

## Agent Skill Integration

This repository ships with a pre-configured Agent Skill in [`skills/web-agent/SKILL.md`](./skills/web-agent/SKILL.md).

It provides AI coding assistants (Claude Code, Antigravity, Cursor, Windsurf, Gemini CLI, etc.) with a complete decision tree, trigger keywords, and parameter guidance for using `webmesh-mcp` tools token-efficiently.

### How to use the skill in your project

Copy or symlink the `skills/` folder into your AI assistant's skills directory:

- **Claude / Antigravity / Gemini CLI**: Place in `.agents/skills/web-agent/SKILL.md` or `~/.gemini/config/skills/web-agent/SKILL.md`
- **Cursor**: Copy contents to `.cursor/rules/web-agent.mdc`
- **Windsurf**: Copy contents to `.windsurfrules`

---

## Tool reference

### `web_scrape`

| Parameter | Type | Default | Description |
|---|---|---|---|
| `url` | `string` (URL) | — | Page to fetch |
| `format` | `"markdown" \| "json"` | `"markdown"` | Output format |
| `schema` | `Record<string, string>` | — | `{field: cssSelector}` — required when `format="json"` |
| `selector` | `string` | — | Scope extraction to a CSS subtree |
| `forceBrowser` | `boolean` | `false` | Skip static tier, always use Chromium |
| `ignoreRobots` | `boolean` | `false` | Bypass `robots.txt` rules |

### `web_check`

| Parameter | Type | Default | Description |
|---|---|---|---|
| `url` | `string` (URL) | — | Page to check |
| `assertion` | enum | — | `contains`, `not_contains`, `selector_exists`, `selector_not_exists`, `text_equals` |
| `value` | `string` | — | Text or CSS selector |
| `selector` | `string` | — | Scope text search to subtree |
| `forceBrowser` | `boolean` | `false` | |
| `ignoreRobots` | `boolean` | `false` | |

### `web_diff`

| Parameter | Type | Default | Description |
|---|---|---|---|
| `url` | `string` (URL) | — | Page to monitor |
| `selector` | `string` | — | Scope watch to subtree (e.g. `.price`) |
| `forceBrowser` | `boolean` | `false` | |
| `ignoreRobots` | `boolean` | `false` | |

Returns `changed: null` on the first call (nothing to compare against),
`true`/`false` on subsequent calls.

### `web_interact`

| Parameter | Type | Default | Description |
|---|---|---|---|
| `url` | `string` (URL) | — | Starting URL |
| `actions` | `Action[]` | — | Sequence of browser actions |
| `resultSelector` | `string` | — | Scope returned ARIA snapshot |
| `screenshot` | `boolean` | `false` | Return base64 PNG (costs image tokens) |
| `sessionId` | `string` | — | Persist cookies/storage across calls |
| `ignoreRobots` | `boolean` | `false` | |

**Action shape:**
```ts
{ type: "click" | "fill" | "select" | "press" | "waitFor", selector?: string, value?: string, timeoutMs?: number }
```

### `web_session_close`

| Parameter | Type | Description |
|---|---|---|
| `sessionId` | `string` | Session to delete |

### `web_crawl`

| Parameter | Type | Default | Description |
|---|---|---|---|
| `startUrl` | `string` (URL) | — | Seed URL |
| `maxDepth` | `number` | `2` | Max link depth (0 = seed only) |
| `maxPages` | `number` | `30` | Hard cap on pages visited |
| `sameHostOnly` | `boolean` | `true` | Restrict to same hostname |
| `includePatterns` | `string[]` | — | Pathname globs URLs must match, e.g. `"/docs/*"` |
| `excludePatterns` | `string[]` | — | Pathname globs URLs must NOT match |
| `contentDepth` | `"none" \| "summary" \| "full"` | `"summary"` | Output verbosity |
| `ignoreRobots` | `boolean` | `false` | |

Full markdown for every visited page is cached in SQLite for `web_crawl_get_page`.

### `web_crawl_get_page`

| Parameter | Type | Description |
|---|---|---|
| `url` | `string` (URL) | Previously crawled URL |

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `MCP_WEB_AGENT_DATA_DIR` | `<cwd>/.webmesh-mcp` | Root directory for cache DB and session files |

Both the SQLite watch/crawl cache (`cache/watch.sqlite`) and session state files
(`sessions/`) live under `MCP_WEB_AGENT_DATA_DIR`. Override it to control where
runtime data is stored.

---

## Security

### SSRF Protection

All outbound fetches — static HTTP, browser navigation, intermediate HTTP redirects, and crawl link-following — are strictly validated against an SSRF blocklist before network connections are established.

- **Protocol Restriction**: Rejects all non-HTTP/HTTPS schemes.
- **Loopback Addresses**: `127.x.x.x`, IPv6 `::1`, `localhost`, IPv6 unspecified `::` / `0:0:0:0:0:0:0:0`.
- **Private RFC-1918 & Unique Local IPv6**: `10.x`, `172.16–31.x`, `192.168.x`, `fc00::/7`, `fd00::/7`.
- **Link-Local & Cloud Metadata**: `169.254.x.x` (AWS/GCP/Azure IMDS), `fe80::/10`.
- **Special & Reserved Ranges**: Multicast (`224.x`), Site-Local (`fec0::/10`), Documentation (`2001:db8::/32`), and IPv4-mapped IPv6 formats (`::ffff:x.x.x.x`).
- **HTTP Redirect Hardening**: Static fetch enforces manual redirect validation loops up to 5 hops, checking `ssrfGuard.assertPublicUrl()` on every intermediate `Location` header before following.
- **Browser Route Interception**: Chromium contexts attach route interceptors (`page.route("**/*")`) to block subresource requests or redirects targeting private IP space.

---

## Architecture

For a detailed technical architecture and end-to-end data flow specification, see [`Architecture.md`](./Architecture.md).

```
index.ts (MCP server, stdio transport)
├── tools/scrape.ts        — web_scrape
├── tools/check.ts         — web_check
├── tools/diff.ts          — web_diff
├── tools/interact.ts      — web_interact
├── tools/crawl.ts         — web_crawl
├── tools/crawlGetPage.ts  — web_crawl_get_page
├── tieredFetch.ts         — static HTTP → browser escalation (manual redirect validation)
├── browserPool.ts         — singleton Chromium process + route interceptor (playwright-core)
├── ssrfGuard.ts           — SSRF protection (blocks private/reserved IPv4 & IPv6 addresses)
├── extract.ts             — HTML → clean markdown / plain text / schema JSON
├── hostGate.ts            — robots.txt parser (regex escaped) + per-host rate-limiting queue
├── sessions.ts            — disk-backed storageState persistence
├── cache.ts               — SQLite: watch hashes + crawled page markdown
└── constants.ts           — shared USER_AGENT, DATA_DIR
```

---

## Development

```bash
git clone https://github.com/creatorpiyush/webmesh-mcp
cd webmesh-mcp
npm install
npx playwright install chromium    # optional, for browser-tier testing

npm run dev        # run MCP server in dev mode (tsx, no compile step)
npm run demo -- https://example.com
npm test           # run the full integration test suite
npm run typecheck  # tsc --noEmit, no output files
npm run format     # format code with prettier
npm run build      # compile to dist/
```

---

## License

MIT — see [LICENSE](./LICENSE).
