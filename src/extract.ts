import * as cheerio from "cheerio";
import TurndownService from "turndown";

// Elements that never carry meaningful page content — stripped before
// anything is measured, extracted, or handed back to an agent.
const NOISE_SELECTORS = [
  "script",
  "style",
  "noscript",
  "svg",
  "iframe",
  "link",
  "meta",
  "nav",
  "header",
  "footer",
  "aside",
  "[aria-hidden='true']",
  "[hidden]",
  ".cookie-banner",
  ".ad",
  ".ads",
  ".advertisement",
  ".gdpr",
  ".popup",
  "[class*='cookie-consent']",
  "[id*='cookie-consent']",
];

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});
// Drop images from markdown output by default — they're rarely needed for
// text extraction/verification tasks and just add token weight (URLs, alt
// text noise). Callers that need media can request raw HTML instead.
turndown.remove("img");

function cleanedDom(html: string) {
  const $ = cheerio.load(html);
  $(NOISE_SELECTORS.join(",")).remove();
  return $;
}

/**
 * Heuristic used by the tiered fetcher to decide whether a static HTTP GET
 * was enough, or whether the page needs real JS execution (SPA shell,
 * client-side rendered content, etc). Cheap, deterministic, no LLM call.
 */
export function isThinContent(html: string): boolean {
  const $ = cleanedDom(html);
  const text = $("body").text().replace(/\s+/g, " ").trim();
  // Two independent signals: extremely thin text (< 100 chars), or a suspiciously empty
  // SPA-style mount point (react/vue/next root divs with near-nothing in them).
  const mountPoint = $("#root, #app, #__next, #___gatsby").first();
  const mountIsEmpty = mountPoint.length > 0 && mountPoint.text().trim().length < 40;
  return text.length < 100 || mountIsEmpty;
}

/**
 * Full-page extraction: strips chrome/noise, keeps the main content region
 * if one is identifiable (article/main/[role=main]), converts to markdown.
 * This is the default "scrape" output — a 200KB page routinely becomes a
 * couple KB of markdown.
 */
export function htmlToCleanMarkdown(html: string, opts?: { selector?: string }): string {
  const $ = cleanedDom(html);

  let root: ReturnType<typeof $> = $("body");
  if (opts?.selector) {
    try {
      const scoped = $(opts.selector);
      if (scoped.length > 0) root = scoped.first();
    } catch {
      // Fallback to body if selector is invalid
    }
  } else {
    const main = $("main, article, [role='main']").first();
    if (main.length > 0) root = main;
  }

  const html2 = $.html(root);
  const md = turndown
    .turndown(html2)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return md;
}

/**
 * Deterministic, LLM-free structured extraction: field name -> CSS selector.
 * This is the cheapest possible path for "I just need these 4 fields off
 * this page" — no markdown conversion, no vision model, just DOM queries.
 */
export function extractBySchema(
  html: string,
  schema: Record<string, string>
): Record<string, string | null> {
  const $ = cleanedDom(html);
  const out: Record<string, string | null> = {};
  for (const [field, selector] of Object.entries(schema)) {
    try {
      const el = $(selector).first();
      out[field] = el.length > 0 ? el.text().replace(/\s+/g, " ").trim() : null;
    } catch {
      out[field] = null;
    }
  }
  return out;
}

/** Plain, whitespace-normalized text — used internally for assertions/diffing. */
export function htmlToPlainText(html: string, opts?: { selector?: string }): string {
  const $ = cleanedDom(html);
  let root: ReturnType<typeof $> = $("body");
  if (opts?.selector) {
    try {
      const scoped = $(opts.selector);
      if (scoped.length > 0) root = scoped;
    } catch {
      // Fallback to body if selector is invalid
    }
  }
  return root
    .text()
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}
