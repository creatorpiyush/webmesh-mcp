---
name: web-agent
description: >
  Use this skill when you need to interact with the web: scraping pages, checking
  claims, monitoring for changes, crawling a site, or automating browser interactions
  (clicks, form fills, sessions). This invokes the mcp-web-agent MCP server tools.
  Trigger keywords: scrape, browse, crawl, web_scrape, web_check, web_diff, web_interact,
  web_crawl, web_crawl_get_page, web_session_close, fetch page, check page, monitor page,
  read website, extract from url, site structure, navigate browser.
---

# Web Agent Skill

This skill gives you access to the **mcp-web-agent** MCP server — a token-economical web
browsing, scraping, and crawling suite. All tools respect `robots.txt` by default.

## MCP Server Setup

The server can be registered in your MCP config via npm:

```json
{
  "mcpServers": {
    "web-agent": {
      "command": "npx",
      "args": ["mcp-web-agent"]
    }
  }
}
```

Or from source:
```json
{
  "mcpServers": {
    "web-agent": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/mcp-web-agent/src/index.ts"]
    }
  }
}
```

---

## Tool Reference

### `web_scrape`
Fetches a URL and returns clean content. Tries static HTTP first; escalates to Playwright
Chromium only if the page requires JavaScript to render.

**Parameters:**
| Name | Type | Default | Description |
|---|---|---|---|
| `url` | string (URL) | — | Page to scrape |
| `format` | `"markdown"` or `"json"` | `"markdown"` | Output format |
| `schema` | `Record<string, string>` | — | `{field: cssSelector}` — required when `format="json"` |
| `selector` | string | — | Scope markdown extraction to this CSS subtree |
| `forceBrowser` | boolean | false | Skip static fetch, always use Chromium |
| `ignoreRobots` | boolean | false | Bypass robots.txt disallow rules |

**Use when:** You want the readable content of a page, or need to extract specific fields.

**Example (markdown):**
```json
{ "url": "https://example.com", "format": "markdown" }
```

**Example (schema JSON):**
```json
{
  "url": "https://pypi.org/project/requests/",
  "format": "json",
  "schema": { "name": "h1.package-header__name", "version": ".release__version" }
}
```

---

### `web_check`
Verifies a claim about a page without returning full content. Returns `pass: true/false`
and a short evidence snippet (200 chars max).

**Parameters:**
| Name | Type | Default | Description |
|---|---|---|---|
| `url` | string (URL) | — | Page to check |
| `assertion` | enum | — | `contains`, `not_contains`, `selector_exists`, `selector_not_exists`, `text_equals` |
| `value` | string | — | Text to find, or CSS selector for selector_* assertions |
| `selector` | string | — | Scope text search to this CSS subtree |
| `forceBrowser` | boolean | false | Use Chromium |
| `ignoreRobots` | boolean | false | Bypass robots.txt |

**Use when:** You need to confirm something is (or isn't) on a page without reading it all.

**Example:**
```json
{
  "url": "https://github.com/anthropics",
  "assertion": "contains",
  "value": "Claude"
}
```

---

### `web_diff`
Checks whether a page (or a scoped subtree) has changed since the last call.
Returns `changed: true | false | null` (null on first call) plus a short snippet.
Results are stored in SQLite at `.cache/watch.sqlite`.

**Parameters:**
| Name | Type | Default | Description |
|---|---|---|---|
| `url` | string (URL) | — | Page to monitor |
| `selector` | string | — | Scope watch to this CSS subtree (e.g. `.price`) |
| `forceBrowser` | boolean | false | Use Chromium |
| `ignoreRobots` | boolean | false | Bypass robots.txt |

**Use when:** You want to poll a page over time and detect changes.

**Example:**
```json
{ "url": "https://example.com/pricing", "selector": ".price-card" }
```

---

### `web_interact`
Runs a sequence of browser actions (click, fill, select, press, waitFor) on a live page.
Always uses Playwright/Chromium. Returns an ARIA accessibility snapshot; screenshots optional.

**Parameters:**
| Name | Type | Default | Description |
|---|---|---|---|
| `url` | string (URL) | — | Starting URL |
| `actions` | `Action[]` | — | Sequence of actions to execute |
| `resultSelector` | string | — | Scope returned snapshot to this subtree |
| `screenshot` | boolean | false | Return a base64 PNG screenshot |
| `sessionId` | string | — | Persist cookies/localStorage across calls |
| `ignoreRobots` | boolean | false | Bypass robots.txt |

**Action shape:**
```ts
{
  type: "click" | "fill" | "select" | "press" | "waitFor",
  selector?: string,  // CSS selector
  value?: string,     // fill value, select option, or key to press
  timeoutMs?: number  // default 10000
}
```

**Use when:** You need to fill a form, click through a login flow, or interact with JS-driven UI.

**Example:**
```json
{
  "url": "https://example.com/login",
  "actions": [
    { "type": "fill", "selector": "#email", "value": "user@example.com" },
    { "type": "fill", "selector": "#password", "value": "secret" },
    { "type": "click", "selector": "button[type=submit]" },
    { "type": "waitFor", "selector": ".dashboard" }
  ],
  "resultSelector": ".dashboard",
  "sessionId": "my-login-session"
}
```

---

### `web_session_close`
Deletes the persisted `storageState` file for a `sessionId`. Use to explicitly log out
or discard a saved session before the 7-day TTL prune.

**Parameters:**
| Name | Type | Description |
|---|---|---|
| `sessionId` | string | Session identifier to delete |

**Example:**
```json
{ "sessionId": "my-login-session" }
```

---

### `web_crawl`
BFS crawl starting from a seed URL. Returns page titles, link structures, and excerpts
for all discovered pages (up to `maxPages`). Full markdown for every page is cached in
SQLite for retrieval via `web_crawl_get_page`.

**Parameters:**
| Name | Type | Default | Description |
|---|---|---|---|
| `startUrl` | string (URL) | — | Seed URL |
| `maxDepth` | number | 2 | Max link depth (0 = seed URL only) |
| `maxPages` | number | 30 | Hard cap on pages visited |
| `sameHostOnly` | boolean | true | Restrict to same hostname |
| `includePatterns` | string[] | — | Glob patterns URLs must match |
| `excludePatterns` | string[] | — | Glob patterns URLs must NOT match |
| `contentDepth` | `"none"`, `"summary"`, or `"full"` | `"summary"` | Output verbosity |
| `ignoreRobots` | boolean | false | Bypass robots.txt |

**Output per page:**
- `url`, `depth`, `parentUrl`, `outboundLinkCount`
- `title`, `excerpt` (first 200 chars) — when `contentDepth != "none"`
- `content` (full markdown) — when `contentDepth === "full"`

**Use when:** You need to map a site's structure, collect all blog posts, or discover links.

**Example:**
```json
{
  "startUrl": "https://docs.example.com",
  "maxDepth": 2,
  "maxPages": 20,
  "contentDepth": "summary",
  "excludePatterns": ["/changelog/*", "/api/*"]
}
```

---

### `web_crawl_get_page`
Retrieves the full cleaned markdown for a URL previously cached by `web_crawl`.
No network request is made — reads directly from SQLite.

**Parameters:**
| Name | Type | Description |
|---|---|---|
| `url` | string (URL) | URL previously discovered by `web_crawl` |

**Use when:** After crawling with `contentDepth: "summary"`, you want the full content of
specific pages the agent picked as relevant.

**Example:**
```json
{ "url": "https://docs.example.com/getting-started" }
```

---

## Recommended Decision Tree

```
Need web data?
|
+-- Single page, read-only
|   +-- Need all content       --> web_scrape (format: markdown)
|   +-- Need specific fields   --> web_scrape (format: json, schema: {...})
|   +-- Need to verify claim   --> web_check
|   +-- Detect changes         --> web_diff
|
+-- Multi-page
|   +-- Map/discover structure --> web_crawl (contentDepth: summary)
|   +-- Read specific pages    --> web_crawl_get_page (after crawl)
|
+-- Need browser interaction
    +-- One-off flow           --> web_interact (no sessionId)
    +-- Multi-step / auth flow --> web_interact with sessionId
                                   end with web_session_close
```

## Important Notes

- **robots.txt is respected by default.** Pass `ignoreRobots: true` only for sites you
  have explicit permission to scrape.
- **Screenshots cost image tokens.** Only pass `screenshot: true` when you need pixel output.
- **Chromium must be installed** for browser-tier tools. Run:
  `npx playwright install chromium` from the project directory.
- **Sessions are sensitive.** Files in `.sessions/` contain auth cookies. They are gitignored
  and pruned after 7 days of inactivity.
