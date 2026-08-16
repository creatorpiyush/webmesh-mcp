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
      let currentUrl = url;
      let redirects = 0;
      let finalRes: Response | null = null;

      while (redirects < 5) {
        const currentParsed = new URL(currentUrl);
        await ssrfGuard.assertPublicUrl(currentUrl);

        const res = await schedule(currentParsed.hostname, () =>
          fetch(currentUrl, {
            headers: { "User-Agent": USER_AGENT },
            redirect: "manual",
            signal: AbortSignal.timeout(timeoutMs),
          })
        );

        if (res.status >= 300 && res.status < 400 && res.headers.has("location")) {
          const loc = res.headers.get("location")!;
          const nextUrl = new URL(loc, currentUrl).href;
          await ssrfGuard.assertPublicUrl(nextUrl);
          currentUrl = nextUrl;
          redirects++;
          continue;
        }

        finalRes = res;
        break;
      }

      if (finalRes && (finalRes.ok || finalRes.status < 400)) {
        const contentLength = parseInt(finalRes.headers.get("content-length") ?? "0", 10);
        if (contentLength > 10 * 1024 * 1024) {
          throw new Error("Response body exceeds maximum allowed size (10MB)");
        }

        const html = await finalRes.text();
        if (html.length > 10 * 1024 * 1024) {
          throw new Error("Response body exceeds maximum allowed size (10MB)");
        }

        if (!isThinContent(html)) {
          return { html, tier: "static", status: finalRes.status, finalUrl: currentUrl };
        }
      }
      // else: fall through to browser tier below
    } catch (err: any) {
      if (err?.message?.includes("Blocked:")) throw err;
      // network-level failure on plain fetch — try the browser tier before giving up
    }
  }

  const { html, finalUrl } = await browserPool.withPage(
    async (page) => {
      await browserPool.goto(page, url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
      if (opts?.waitForSelector) {
        await page.waitForSelector(opts.waitForSelector, { timeout: timeoutMs }).catch(() => {});
      } else {
        // give client-side rendering a brief moment without an arbitrary long wait
        await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {});
      }
      return { html: await page.content(), finalUrl: page.url() };
    },
    { storageState: opts?.storageState }
  );

  return { html, tier: "browser", finalUrl };
}
