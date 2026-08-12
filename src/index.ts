#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { scrape } from "./tools/scrape.js";
import { check } from "./tools/check.js";
import { diff } from "./tools/diff.js";
import { interact } from "./tools/interact.js";
import { crawl } from "./tools/crawl.js";
import { crawlGetPage } from "./tools/crawlGetPage.js";
import { deleteSession } from "./sessions.js";
import { browserPool } from "./browserPool.js";

// Import version from package.json so it's always in sync with the published version.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

const server = new McpServer({ name: "webmesh-mcp", version });

// --- Zod schemas (defined once, used for both inputSchema and z.infer) ---

const scrapeSchema = {
  url: z.string().url(),
  format: z.enum(["markdown", "json"]).default("markdown"),
  schema: z
    .record(z.string(), z.string())
    .optional()
    .describe("field name -> CSS selector, required when format=json"),
  selector: z
    .string()
    .optional()
    .describe("scope markdown extraction to this CSS selector subtree"),
  forceBrowser: z
    .boolean()
    .default(false)
    .describe("skip the static-fetch tier for pages known to require JS"),
  ignoreRobots: z.boolean().default(false).describe("ignore robots.txt restriction rules"),
};

const checkSchema = {
  url: z.string().url(),
  assertion: z.enum([
    "contains",
    "not_contains",
    "selector_exists",
    "selector_not_exists",
    "text_equals",
  ]),
  value: z.string().describe("text to search for, or CSS selector for the selector_* assertions"),
  selector: z.string().optional().describe("scope the text search to this subtree"),
  forceBrowser: z.boolean().default(false),
  ignoreRobots: z.boolean().default(false),
};

const diffSchema = {
  url: z.string().url(),
  selector: z.string().optional().describe("scope the watch to this subtree, e.g. '.price'"),
  forceBrowser: z.boolean().default(false),
  ignoreRobots: z.boolean().default(false),
};

const interactSchema = {
  url: z.string().url(),
  actions: z.array(
    z.object({
      type: z.enum(["click", "fill", "select", "press", "waitFor"]),
      selector: z.string().optional(),
      value: z.string().optional(),
      timeoutMs: z.number().optional(),
    })
  ),
  resultSelector: z.string().optional().describe("scope the returned snapshot to this subtree"),
  screenshot: z.boolean().default(false),
  sessionId: z
    .string()
    .optional()
    .describe("persist cookies/localStorage under this session identifier across calls"),
  ignoreRobots: z.boolean().default(false),
};

const sessionCloseSchema = {
  sessionId: z.string().describe("the session identifier to delete"),
};

const crawlSchema = {
  startUrl: z.string().url(),
  maxDepth: z.number().default(2).describe("max link depth to traverse (0 = startUrl only)"),
  maxPages: z.number().default(30).describe("max total pages to visit"),
  sameHostOnly: z.boolean().default(true).describe("restrict crawl to pages on the same hostname"),
  includePatterns: z
    .array(z.string())
    .optional()
    .describe("pathname glob patterns URLs must match, e.g. '/docs/*'"),
  excludePatterns: z
    .array(z.string())
    .optional()
    .describe("pathname glob patterns URLs must NOT match"),
  contentDepth: z.enum(["none", "summary", "full"]).default("summary"),
  ignoreRobots: z.boolean().default(false),
};

const crawlGetPageSchema = {
  url: z.string().url(),
};

// --- Tool registrations ---

server.registerTool(
  "web_scrape",
  {
    title: "Scrape a webpage",
    description:
      "Fetch a URL and return clean content — markdown by default, or " +
      "specific fields via a CSS-selector schema. Tries a plain HTTP fetch " +
      "first and only launches a browser if the page needs JS to render.",
    inputSchema: scrapeSchema,
  },
  async (input) => {
    const result = await scrape(input);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "web_check",
  {
    title: "Check a claim about a webpage",
    description:
      "Verify something about a page (text present/absent, element " +
      "present/absent, exact text match) without returning the whole page " +
      "— just a pass/fail and a short evidence snippet.",
    inputSchema: checkSchema,
  },
  async (input) => {
    const result = await check(input);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "web_diff",
  {
    title: "Monitor a webpage for changes",
    description:
      "Check whether a page (or a subtree of it) has changed since the " +
      "last check. Returns changed=true/false and a short snippet — not " +
      "the full content — so repeated monitoring stays cheap.",
    inputSchema: diffSchema,
  },
  async (input) => {
    const result = await diff(input);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "web_interact",
  {
    title: "Interact with a webpage",
    description:
      "Run a sequence of actions (click, fill, select, press, waitFor) on " +
      "a live page — for testing flows or reaching content behind " +
      "interaction. Returns a text accessibility snapshot by default; pass " +
      "screenshot=true only when you actually need to see pixels.",
    inputSchema: interactSchema,
  },
  async (input) => {
    const result = await interact(input);
    const content: (
      { type: "text"; text: string } | { type: "image"; data: string; mimeType: string }
    )[] = [
      {
        type: "text",
        text: JSON.stringify(
          {
            ariaSnapshot: result.ariaSnapshot,
            finalUrl: result.finalUrl,
            blocked: result.blocked,
            blockedReason: result.blockedReason,
          },
          null,
          2
        ),
      },
    ];
    if (result.screenshotBase64) {
      content.push({ type: "image", data: result.screenshotBase64, mimeType: "image/png" });
    }
    return { content };
  }
);

server.registerTool(
  "web_session_close",
  {
    title: "Close and delete a web interaction session",
    description: "Delete persisted cookies and storageState for a given sessionId.",
    inputSchema: sessionCloseSchema,
  },
  async (input) => {
    await deleteSession(input.sessionId);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ success: true, sessionId: input.sessionId }, null, 2),
        },
      ],
    };
  }
);

server.registerTool(
  "web_crawl",
  {
    title: "Crawl a website starting from a seed URL",
    description:
      "Perform a BFS crawl starting at startUrl up to maxDepth/maxPages. " +
      "Returns page titles, link structures, and excerpts, while caching full markdown for web_crawl_get_page.",
    inputSchema: crawlSchema,
  },
  async (input) => {
    const result = await crawl(input);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "web_crawl_get_page",
  {
    title: "Retrieve full markdown for a previously crawled page",
    description: "Fetch cached page content discovered during a web_crawl call.",
    inputSchema: crawlGetPageSchema,
  },
  async (input) => {
    const result = await crawlGetPage(input);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// --- Process lifecycle ---

async function shutdown() {
  await browserPool.shutdown();
  process.exit(0);
}

// Handle both SIGINT (Ctrl+C) and SIGTERM (Docker/k8s/systemd stop signals)
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
