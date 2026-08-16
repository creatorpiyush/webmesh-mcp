# Changelog

All notable changes to `webmesh-mcp` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.2] - 2026-08-16

### Security
- **Hardened IPv6 SSRF Validation (`src/ssrfGuard.ts`)**: Blocked IPv6 unspecified address (`::`), site-local (`fec0::/10`), documentation (`2001:db8::/32`), and all IPv4-mapped IPv6 address formats (`::ffff:x.x.x.x`).
- **HTTP Redirect Validation (`src/tieredFetch.ts`)**: Implemented manual redirect validation loops up to 5 hops, checking `ssrfGuard.assertPublicUrl()` on every intermediate `Location` header before following static redirects.
- **Browser Route Interception (`src/browserPool.ts`)**: Attached route interceptors (`page.route("**/*")`) to block subresource requests or redirects targeting private IP ranges.
- **SSRF Guard for Robots.txt (`src/hostGate.ts`)**: Added `ssrfGuard.assertPublicUrl()` validation before making `/robots.txt` outbound HTTP requests.

### Fixed
- **Regex Parsing in `SimpleRobotsParser` (`src/hostGate.ts`)**: Safely escaped special regex characters (including `?`, `.`, `[`, `]`) in `robots.txt` path rules, preventing `SyntaxError` crashes and path matching corruption.
- **Dynamic Rate Limit Updating (`src/hostGate.ts`)**: Added `updateInterval()` to `SimpleHostQueue` to dynamically update queue intervals when a higher `Crawl-delay` is returned from robots checks.
- **Browser Pool Crash Recovery (`src/browserPool.ts`)**: Added `isConnected()` health checks in `getBrowser()` to detect process crashes and automatically re-launch Chromium.
- **Cheerio Invalid Selector Handling (`src/extract.ts`)**: Wrapped DOM selector lookups in try/catch blocks to gracefully handle invalid CSS selectors without crashing.
- **Crawl Seed URL & Glob Matching (`src/tools/crawl.ts`)**: Safely handled invalid `startUrl` inputs and updated pattern matching logic to match section root paths for glob patterns ending with `/*`.
- **Browser Tier `finalUrl` Preservation (`src/tieredFetch.ts`)**: Updated browser fetch tier to return `page.url()` so post-navigation URLs are correctly preserved.

### Added
- **Technical Architecture Specification (`Architecture.md`)**: Created comprehensive architecture and design document with Mermaid data flow diagrams, security model breakdowns, and tool execution lifecycle details.

## [1.0.1] - 2026-08-12

### Security
- **SSRF protection (`src/ssrfGuard.ts`)**: Added `assertPublicUrl()` guard that blocks fetches to loopback (`127.x`, `::1`), private RFC-1918 ranges (`10.x`, `172.16–31.x`, `192.168.x`), link-local/cloud metadata addresses (`169.254.x.x`), multicast/reserved ranges, and `localhost`. The guard is called in three places so no fetch path is unprotected:
  - `tieredFetch.ts` — covers `web_scrape`, `web_check`, `web_diff`, and the static-HTTP tier of `web_crawl`.
  - `browserPool.goto()` — covers `web_interact`, which calls the browser directly without going through `tieredFetch`.
  - `crawl.ts` link enqueueing — drops discovered links pointing at private addresses before they are queued, rather than generating blocked result entries.
- `ignoreRobots: true` no longer has any effect on SSRF protection; robots.txt opt-out and internal-network blocking are independent concerns.

> **Note:** DNS rebinding is not fully mitigated — a hostname that resolves to a public IP at check-time can still resolve to a private IP at TCP-connect-time (inside `fetch`/Playwright's own resolver). This patch closes the common/naive case. Full rebinding protection (IP pinning via a custom dispatcher or local proxy) is a follow-up for high-trust-boundary deployments.

## [1.0.0] - 2026-08-12

### Added
- **MCP Server Suite**:
  - `web_scrape`: Fetch webpage content to clean markdown or CSS schema-based JSON.
  - `web_check`: Server-side claim verification (`contains`, `not_contains`, `selector_exists`, `selector_not_exists`, `text_equals`) returning pass/fail and evidence snippet.
  - `web_diff`: Page change monitoring with SQLite content-hash storage.
  - `web_interact`: Multi-step browser automation (`click`, `fill`, `select`, `press`, `waitFor`) returning ARIA accessibility snapshots.
  - `web_session_close`: Explicit session deletion for Playwright storage states.
  - `web_crawl`: Breadth-First Search (BFS) crawler supporting depth limits, host restriction, and pathname glob patterns.
  - `web_crawl_get_page`: Instant cached markdown retrieval from SQLite for crawled URLs.
- **Host Gate Subsystem (`src/hostGate.ts`)**:
  - Built zero-dependency `robots.txt` parser supporting `User-agent`, `Allow`, `Disallow`, and `Crawl-delay` rules with longest-path matching.
  - Added per-host request queue enforcing 4 req/sec rate limit (or `Crawl-delay`).
  - Added `ignoreRobots` input parameter across all fetch tools.
- **Session Persistence (`src/sessions.ts`)**:
  - Atomic disk-backed storage for Playwright `storageState` with 7-day TTL pruning.
- **SQLite Storage & Caching (`src/cache.ts`)**:
  - Added `crawled_pages` table for cached full page markdown.
  - Configurable data directory via `MCP_WEB_AGENT_DATA_DIR` env variable (defaults to `.webmesh-mcp/`).
- **Shipped Agent Skills (`skills/`)**:
  - `skills/web-agent/SKILL.md`: Core tool reference and decision tree.
  - `skills/web-researcher/SKILL.md`: Multi-page documentation research workflow.
  - `skills/web-page-monitor/SKILL.md`: Change detection & auditing guide.
- **Developer Tooling & CI/CD**:
  - Switch to lightweight `playwright-core` with configurable `BrowserPoolOptions` (`executablePath`, `args`, `env`).
  - Standalone integration test runner (`src/test_all_tools.ts`).
  - Automated `scripts/pre-commit.sh` and `scripts/pre-release.sh` shell scripts.
  - GitHub Actions CI workflows for PR verification (`.github/workflows/pr-verify.yml`) and automated npm publishing (`.github/workflows/publish-npm.yml`).
