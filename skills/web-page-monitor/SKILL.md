---
name: web-page-monitor
description: >
  Use this skill when monitoring websites for changes, verifying UI elements/claims, or tracking releases and pricing.
  Guides the agent on scoping checks to CSS subtrees and using web_check / web_diff for zero-token-overhead auditing.
  Trigger keywords: monitor page, track price, check change, watch URL, page audit, verify element.
---

# Web Page Monitor Skill

This skill guides AI agents on auditing websites and monitoring page elements for changes using `mcp-web-agent`.

## Recommended Patterns

### 1. Change Detection (`web_diff`)
Use `web_diff` to determine if a page (or specific element) changed since the last check.

- **Always scope to a CSS selector when possible.**
  - Good: `{ "url": "https://example.com/pricing", "selector": ".pricing-table" }`
  - Bad: `{ "url": "https://example.com/pricing" }` (may trigger false positives from dynamic timestamps or ad banners)
- **Interpret results:**
  - `changed: null` → Baseline saved (first run).
  - `changed: false` → No changes detected.
  - `changed: true` → Page/element content changed! Returns updated snippet.

### 2. Element & Claim Verification (`web_check`)
Use `web_check` to verify specific assertions without loading full markdown content.

- **Check element existence:**
  - `{ "url": "https://status.example.com", "assertion": "selector_exists", "value": ".status-ok" }`
- **Verify text present:**
  - `{ "url": "https://example.com/news", "assertion": "contains", "value": "Release v2.0" }`
- **Verify text absent:**
  - `{ "url": "https://status.example.com", "assertion": "not_contains", "value": "Outage" }`
