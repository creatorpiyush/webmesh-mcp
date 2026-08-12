import { browserPool } from "./browserPool.js";
import { isThinContent } from "./extract.js";
import { checkRobots, schedule } from "./hostGate.js";
import { ssrfGuard } from "./ssrfGuard.js";
import type { BrowserContextOptions } from "playwright-core";
import { USER_AGENT } from "./constants.js";

export type FetchTier = "static" | "browser";

export interface TieredFetchResult {
  html: string;
  tier: FetchTier;
  status?: number;
  finalUrl: string;
  blocked?: boolean;
  blockedReason?: string;
}

/**
 * The single biggest cost lever in this whole design: most pages do NOT
 * need a browser. A plain HTTP GET + heuristic is enough for the majority
 * of scrape/check/diff calls, and skips Chromium entirely (no launch, no
 * JS execution, no screenshot/DOM-tree cost). Only pages that render
 * client-side (thin static HTML, empty SPA mount point) get escalated.
 */
export async function tieredFetch(
  url: string,
  opts?: {
    forceBrowser?: boolean;
    waitForSelector?: string;
    timeoutMs?: number;
    ignoreRobots?: boolean;
    storageState?: BrowserContextOptions["storageState"];
  }
): Promise<TieredFetchResult> {
  const timeoutMs = opts?.timeoutMs ?? 15_000;
  const parsedUrl = new URL(url);

  await ssrfGuard.assertPublicUrl(url);

  if (!opts?.ignoreRobots) {
    const robotsCheck = await checkRobots(url);
    if (!robotsCheck.allowed) {
      return {
        html: "",
        tier: "static",
        finalUrl: url,
        blocked: true,
        blockedReason: "robots.txt disallows crawling/fetching this path",
      };
    }
  }

  if (!opts?.forceBrowser) {
    try {
      const res = await schedule(parsedUrl.hostname, () =>
        fetch(url, {
          headers: { "User-Agent": USER_AGENT },
          signal: AbortSignal.timeout(timeoutMs),
        })
      );
      const html = await res.text();
      if (!isThinContent(html)) {
        return { html, tier: "static", status: res.status, finalUrl: res.url || url };
      }
      // else: fall through to browser tier below
    } catch {
      // network-level failure on plain fetch — try the browser tier before giving up
    }
  }

  const html = await browserPool.withPage(
    async (page) => {
      await browserPool.goto(page, url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
      if (opts?.waitForSelector) {
        await page.waitForSelector(opts.waitForSelector, { timeout: timeoutMs }).catch(() => {});
      } else {
        // give client-side rendering a brief moment without an arbitrary long wait
        await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {});
      }
      return page.content();
    },
    { storageState: opts?.storageState }
  );

  return { html, tier: "browser", finalUrl: url };
}
