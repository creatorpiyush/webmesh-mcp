import { browserPool } from "../browserPool.js";
import { loadSession, saveSession } from "../sessions.js";
import { checkRobots } from "../hostGate.js";
import { ssrfGuard } from "../ssrfGuard.js";
import type { Page, BrowserContextOptions } from "playwright-core";

export type ActionType = "click" | "fill" | "select" | "press" | "waitFor";

export interface Action {
  type: ActionType;
  selector?: string;
  value?: string;
  timeoutMs?: number;
}

export interface InteractInput {
  url: string;
  actions: Action[];
  /** after actions run, scope the returned result to this subtree (e.g. a success/error banner) */
  resultSelector?: string;
  /**
   * Screenshots are the most expensive thing this whole server can return
   * (image tokens). Off by default — the accessibility tree covers the vast
   * majority of "did this work" checks. Only set this when you actually
   * need to look at layout/rendering, not just DOM state.
   */
  screenshot?: boolean;
  sessionId?: string;
  ignoreRobots?: boolean;
}

export interface InteractOutput {
  /** compact YAML-style aria snapshot (role/name/value tree) — cheap text, usually enough to confirm outcomes */
  ariaSnapshot: string;
  /** present only when screenshot=true was explicitly requested */
  screenshotBase64?: string;
  finalUrl: string;
  blocked?: boolean;
  blockedReason?: string;
}

async function runAction(page: Page, action: Action) {
  const timeout = action.timeoutMs ?? 10_000;
  switch (action.type) {
    case "click":
      if (!action.selector) throw new Error("click requires a selector");
      await page.click(action.selector, { timeout });
      break;
    case "fill":
      if (!action.selector || action.value === undefined)
        throw new Error("fill requires a selector and value");
      await page.fill(action.selector, action.value, { timeout });
      break;
    case "select":
      if (!action.selector || action.value === undefined)
        throw new Error("select requires a selector and value");
      await page.selectOption(action.selector, action.value, { timeout });
      break;
    case "press":
      if (!action.selector || !action.value)
        throw new Error("press requires a selector and a key value");
      await page.press(action.selector, action.value, { timeout });
      break;
    case "waitFor":
      if (!action.selector) throw new Error("waitFor requires a selector");
      await page.waitForSelector(action.selector, { timeout });
      break;
    default:
      throw new Error(`Unknown action type: ${(action as Action).type}`);
  }
}

export async function interact(input: InteractInput): Promise<InteractOutput> {
  await ssrfGuard.assertPublicUrl(input.url);

  if (!input.ignoreRobots) {
    const robotsCheck = await checkRobots(input.url);
    if (!robotsCheck.allowed) {
      return {
        ariaSnapshot: "",
        finalUrl: input.url,
        blocked: true,
        blockedReason: "robots.txt disallows interacting with this path",
      };
    }
  }

  const storageState = input.sessionId ? await loadSession(input.sessionId) : undefined;

  return browserPool.withPage(
    async (page, context) => {
      await browserPool.goto(page, input.url, { waitUntil: "domcontentloaded", timeout: 15_000 });

      for (const action of input.actions) {
        await runAction(page, action);
      }

      let ariaSnapshot = "";
      if (input.resultSelector) {
        const loc = page.locator(input.resultSelector);
        if ((await loc.count()) > 0) {
          ariaSnapshot =
            (await loc
              .first()
              .ariaSnapshot()
              .catch(() => "")) || "";
        } else {
          ariaSnapshot = `[selector "${input.resultSelector}" not found]`;
        }
      } else {
        ariaSnapshot =
          (await page
            .locator("body")
            .ariaSnapshot()
            .catch(() => "")) || "";
      }

      const out: InteractOutput = {
        ariaSnapshot,
        finalUrl: page.url(),
      };

      if (input.screenshot) {
        try {
          const buf =
            input.resultSelector && (await page.locator(input.resultSelector).count()) > 0
              ? await page.locator(input.resultSelector).first().screenshot()
              : await page.screenshot();
          out.screenshotBase64 = buf.toString("base64");
        } catch {
          // Fallback if screenshot fails
        }
      }

      if (input.sessionId) {
        const state = await context.storageState();
        await saveSession(input.sessionId, state);
      }

      return out;
    },
    { storageState }
  );
}
