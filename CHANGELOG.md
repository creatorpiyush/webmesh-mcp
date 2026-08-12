# Changelog

All notable changes to `mcp-web-agent` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
  - Configurable data directory via `MCP_WEB_AGENT_DATA_DIR` env variable (defaults to `.mcp-web-agent/`).
- **Shipped Agent Skills (`skills/`)**:
  - `skills/web-agent/SKILL.md`: Core tool reference and decision tree.
  - `skills/web-researcher/SKILL.md`: Multi-page documentation research workflow.
  - `skills/web-page-monitor/SKILL.md`: Change detection & auditing guide.
- **Developer Tooling & CI/CD**:
  - Switch to lightweight `playwright-core` with configurable `BrowserPoolOptions` (`executablePath`, `args`, `env`).
  - Standalone integration test runner (`src/test_all_tools.ts`).
  - Automated `scripts/pre-commit.sh` and `scripts/pre-release.sh` shell scripts.
  - GitHub Actions CI workflows for PR verification (`.github/workflows/pr-verify.yml`) and automated npm publishing (`.github/workflows/publish-npm.yml`).
