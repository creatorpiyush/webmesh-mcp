import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
  type BrowserContextOptions,
} from "playwright-core";
import { schedule } from "./hostGate.js";
import { ssrfGuard } from "./ssrfGuard.js";
import { USER_AGENT } from "./constants.js";

/**
 * Options for the browser pool. All fields are optional — the pool works
 * out-of-the-box with no config, but callers that want to connect to an
 * existing browser or supply a custom Chromium binary can do so here.
 */
export interface BrowserPoolOptions {
  /**
   * Path to a Chromium/Chrome/Edge executable. When omitted the pool will
   * launch the Playwright-managed Chromium binary (requires
   * `npx playwright install chromium`).
   */
  executablePath?: string;
  /**
   * Extra CLI flags forwarded to the browser process, e.g.
   * `["--no-sandbox", "--disable-setuid-sandbox"]` in Docker.
   */
  args?: string[];
  /** Forward environment variables to the browser process. */
  env?: Record<string, string>;
}

/**
 * A single persistent Chromium process, shared across every call into this
 * server. Launching a browser is the single most expensive fixed cost in
 * any "agent drives a browser" design (roughly 1-2s and real memory) — the
 * naive per-call approach (launch, act, close) pays that cost every time.
 * Here it's paid once per server lifetime, and contexts (cheap, isolated
 * cookie/storage jars) are opened/closed per request instead.
 */
class BrowserPool {
  private browser: Browser | null = null;
  private launching: Promise<Browser> | null = null;
  private opts: BrowserPoolOptions;

  constructor(opts: BrowserPoolOptions = {}) {
    this.opts = opts;
  }

  private async getBrowser(): Promise<Browser> {
    if (this.browser && this.browser.isConnected()) return this.browser;
    this.browser = null;

    if (!this.launching) {
      this.launching = chromium
        .launch({
          headless: true,
          executablePath: this.opts.executablePath,
          args: this.opts.args,
          env: this.opts.env,
        })
        .catch((err: Error) => {
          this.launching = null;
          throw new Error(
            `Failed to launch Chromium. If this is a fresh install, run ` +
              `"npx playwright install chromium" first. Original error: ${err.message}`
          );
        });
    }
    this.browser = await this.launching;
    this.launching = null;
    return this.browser;
  }

  /** Fresh isolated context (own cookies/localStorage) for one logical task. */
  async newContext(options?: Pick<BrowserContextOptions, "storageState">): Promise<BrowserContext> {
    const browser = await this.getBrowser();
    return browser.newContext({
      userAgent: USER_AGENT,
      storageState: options?.storageState,
    });
  }

  async withPage<T>(
    fn: (page: Page, context: BrowserContext) => Promise<T>,
    options?: Pick<BrowserContextOptions, "storageState">
  ): Promise<T> {
    const ctx = await this.newContext(options);
    try {
      const page = await ctx.newPage();
      await page.route("**/*", async (route) => {
        const reqUrl = route.request().url();
        if (reqUrl.startsWith("http://") || reqUrl.startsWith("https://")) {
          try {
            await ssrfGuard.assertPublicUrl(reqUrl);
            await route.continue();
          } catch {
            await route.abort("blockedbyclient");
          }
        } else {
          await route.continue();
        }
      });
      return await fn(page, ctx);
    } finally {
      await ctx.close().catch(() => {}); // closes context+page; browser process stays warm
    }
  }

  async goto(page: Page, url: string, options?: Parameters<Page["goto"]>[1]) {
    await ssrfGuard.assertPublicUrl(url);
    const parsed = new URL(url);
    return schedule(parsed.hostname, () => page.goto(url, options));
  }

  async shutdown() {
    this.launching = null;
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }
  }
}

export const browserPool = new BrowserPool();
