---
name: web-researcher
description: >
  Use this skill when performing multi-page web research, documentation lookup, or tech stack investigation.
  Teaches the agent how to systematically crawl, select relevant links, and retrieve full cached markdown using
  webmesh-mcp without overflowing token context.
  Trigger keywords: research website, investigate docs, read documentation, summarize site, search website, technical research.
---

# Web Researcher Skill

This skill guides AI agents on how to conduct deep, structured web research using `webmesh-mcp` tools with minimal token consumption.

## Research Workflow Strategy

```
Phase 1: Discover Structure
   └── web_crawl (startUrl, maxDepth: 2, contentDepth: "summary")
       └── Collect page titles, link graph, and 200-char excerpts

Phase 2: Evaluate & Select
   └── Inspect returned summaries (zero LLM token waste)
   └── Identify top 2-5 URLs directly relevant to the query

Phase 3: Deep Extraction
   └── web_crawl_get_page (for each selected URL)
       └── Read full cached markdown directly from SQLite cache

Phase 4: Synthesis
   └── Produce final concise summary/report for the user
```

## Best Practices

1. **Never use `contentDepth: "full"` on large crawls.** It returns full markdown for every discovered page in one response, which can overflow context windows. Use `summary` first.
2. **Use `includePatterns` / `excludePatterns`.**
   - Include: `["/docs/*", "/api/*", "/guide/*"]`
   - Exclude: `["/changelog/*", "/blog/*", "/privacy*"]`
3. **Fallback to `web_scrape`.** If `web_crawl` discovers external links outside `sameHostOnly`, call `web_scrape` individually on those key external links.
