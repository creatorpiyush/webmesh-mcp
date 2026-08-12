import * as cheerio from "cheerio";
import { tieredFetch } from "../tieredFetch.js";
import { htmlToCleanMarkdown } from "../extract.js";
import { putCrawledPage } from "../cache.js";

export interface CrawlInput {
  startUrl: string;
  maxDepth?: number; // default 2; 0 = startUrl only
  maxPages?: number; // default 30
  sameHostOnly?: boolean; // default true
  includePatterns?: string[]; // glob/regex patterns
  excludePatterns?: string[];
  contentDepth?: "none" | "summary" | "full"; // default "summary"
  ignoreRobots?: boolean;
}

export interface CrawlPageItem {
  url: string;
  depth: number;
  parentUrl: string | null;
  outboundLinkCount: number;
  title?: string;
  excerpt?: string; // first ~200 chars, included when contentDepth != "none"
  content?: string; // full markdown, included only when contentDepth === "full"
  blocked?: boolean;
  blockedReason?: string;
}

export interface CrawlOutput {
  startUrl: string;
  totalPagesVisited: number;
  pages: CrawlPageItem[];
}

export function normalizeUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    parsed.hash = "";

    // Strip common tracking query params
    const trackingParams = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "ref",
      "fbclid",
      "gclid",
    ];
    for (const p of trackingParams) {
      parsed.searchParams.delete(p);
    }

    let pathname = parsed.pathname;
    if (pathname.length > 1 && pathname.endsWith("/")) {
      pathname = pathname.slice(0, -1);
    }
    parsed.pathname = pathname;

    return parsed.href;
  } catch {
    return null;
  }
}

function patternToRegex(pattern: string): RegExp {
  // Convert basic glob pattern (e.g. "/docs/*") into a Regex
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

function matchesAnyPattern(url: string, patterns?: string[]): boolean {
  if (!patterns || patterns.length === 0) return false;
  // Test against pathname only so patterns like "/docs/*" work without
  // having to account for the "https://example.com" prefix.
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    pathname = url;
  }
  return patterns.some((p) => {
    try {
      return patternToRegex(p).test(pathname);
    } catch {
      return false;
    }
  });
}

export async function crawl(input: CrawlInput): Promise<CrawlOutput> {
  const maxDepth = input.maxDepth ?? 2;
  const maxPages = input.maxPages ?? 30;
  const sameHostOnly = input.sameHostOnly ?? true;
  const contentDepth = input.contentDepth ?? "summary";

  const startNormalized = normalizeUrl(input.startUrl) ?? input.startUrl;
  const startHost = new URL(startNormalized).hostname;

  const queue: { url: string; depth: number; parentUrl: string | null }[] = [
    { url: startNormalized, depth: 0, parentUrl: null },
  ];

  const visited = new Set<string>();
  const pages: CrawlPageItem[] = [];

  while (queue.length > 0 && visited.size < maxPages) {
    const current = queue.shift()!;
    if (visited.has(current.url)) continue;
    visited.add(current.url);

    const fetchRes = await tieredFetch(current.url, { ignoreRobots: input.ignoreRobots });

    if (fetchRes.blocked) {
      pages.push({
        url: current.url,
        depth: current.depth,
        parentUrl: current.parentUrl,
        outboundLinkCount: 0,
        blocked: true,
        blockedReason: fetchRes.blockedReason,
      });
      continue;
    }

    const $ = cheerio.load(fetchRes.html);
    const title = $("title").first().text().trim() || undefined;
    const md = htmlToCleanMarkdown(fetchRes.html);

    // Persist full clean content into SQLite cache
    putCrawledPage(fetchRes.finalUrl, md, title);

    // Extract outbound links
    const outboundLinks: string[] = [];
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href");
      if (!href) return;
      try {
        const resolved = new URL(href, fetchRes.finalUrl).href;
        if (resolved.startsWith("http://") || resolved.startsWith("https://")) {
          const norm = normalizeUrl(resolved);
          if (norm) outboundLinks.push(norm);
        }
      } catch {
        // Ignore invalid URLs
      }
    });

    const uniqueLinks = Array.from(new Set(outboundLinks));

    // Enqueue child links if depth allows
    if (current.depth < maxDepth) {
      for (const link of uniqueLinks) {
        if (visited.has(link)) continue;

        try {
          const linkHost = new URL(link).hostname;
          if (sameHostOnly && linkHost !== startHost) continue;
        } catch {
          continue;
        }

        if (input.includePatterns && input.includePatterns.length > 0) {
          if (!matchesAnyPattern(link, input.includePatterns)) continue;
        }

        if (input.excludePatterns && input.excludePatterns.length > 0) {
          if (matchesAnyPattern(link, input.excludePatterns)) continue;
        }

        queue.push({ url: link, depth: current.depth + 1, parentUrl: current.url });
      }
    }

    const pageItem: CrawlPageItem = {
      url: fetchRes.finalUrl,
      depth: current.depth,
      parentUrl: current.parentUrl,
      outboundLinkCount: uniqueLinks.length,
      title,
    };

    if (contentDepth === "summary") {
      pageItem.excerpt = md.slice(0, 200);
    } else if (contentDepth === "full") {
      pageItem.content = md;
      pageItem.excerpt = md.slice(0, 200);
    }

    pages.push(pageItem);
  }

  return {
    startUrl: input.startUrl,
    totalPagesVisited: pages.length,
    pages,
  };
}
