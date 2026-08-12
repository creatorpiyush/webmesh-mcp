import { tieredFetch } from "../tieredFetch.js";
import { htmlToCleanMarkdown, extractBySchema } from "../extract.js";

export interface ScrapeInput {
  url: string;
  /** "markdown" (default) for readable content, "json" for schema-based fields. */
  format?: "markdown" | "json";
  /** field name -> CSS selector, only used when format="json" */
  schema?: Record<string, string>;
  /** scope markdown extraction to a CSS selector subtree instead of whole page */
  selector?: string;
  /** skip the static-fetch tier and go straight to a real browser (for pages you already know are JS-only) */
  forceBrowser?: boolean;
  ignoreRobots?: boolean;
}

export interface ScrapeOutput {
  tier: "static" | "browser";
  format: "markdown" | "json";
  content: string | Record<string, string | null>;
  finalUrl: string;
  /** rough proxy for what this would have cost as raw HTML vs what's returned */
  approxCharsSaved: number;
  blocked?: boolean;
  blockedReason?: string;
}

export async function scrape(input: ScrapeInput): Promise<ScrapeOutput> {
  const fetchRes = await tieredFetch(input.url, {
    forceBrowser: input.forceBrowser,
    ignoreRobots: input.ignoreRobots,
  });

  if (fetchRes.blocked) {
    return {
      tier: fetchRes.tier,
      format: input.format ?? "markdown",
      content: "",
      finalUrl: fetchRes.finalUrl,
      approxCharsSaved: 0,
      blocked: true,
      blockedReason: fetchRes.blockedReason,
    };
  }

  const { html, tier, finalUrl } = fetchRes;

  if (input.format === "json") {
    if (!input.schema) throw new Error("format=json requires a schema (field -> CSS selector)");
    const content = extractBySchema(html, input.schema);
    return {
      tier,
      format: "json",
      content,
      finalUrl,
      approxCharsSaved: html.length - JSON.stringify(content).length,
    };
  }

  const md = htmlToCleanMarkdown(html, { selector: input.selector });
  return {
    tier,
    format: "markdown",
    content: md,
    finalUrl,
    approxCharsSaved: html.length - md.length,
  };
}
