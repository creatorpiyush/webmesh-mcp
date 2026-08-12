import { tieredFetch } from "../tieredFetch.js";
import { htmlToPlainText } from "../extract.js";
import { hashText, watchKey, getWatch, putWatch } from "../cache.js";

export interface DiffInput {
  url: string;
  /** scope the watch to a subtree, e.g. ".price" — avoids false positives from ads/timestamps elsewhere on the page */
  selector?: string;
  forceBrowser?: boolean;
  ignoreRobots?: boolean;
}

export interface DiffOutput {
  /** null on the very first check for this url+selector — nothing to compare against yet */
  changed: boolean | null;
  tier: "static" | "browser";
  lastCheckedAt: string | null;
  snippet: string;
  blocked?: boolean;
  blockedReason?: string;
}

const SNIPPET_LEN = 300;

export async function diff(input: DiffInput): Promise<DiffOutput> {
  const key = watchKey(input.url, input.selector);
  const prev = getWatch(key);

  const fetchRes = await tieredFetch(input.url, {
    forceBrowser: input.forceBrowser,
    ignoreRobots: input.ignoreRobots,
  });

  if (fetchRes.blocked) {
    return {
      changed: null,
      tier: fetchRes.tier,
      lastCheckedAt: prev ? new Date(prev.checked_at).toISOString() : null,
      snippet: fetchRes.blockedReason ?? "Blocked by robots.txt",
      blocked: true,
      blockedReason: fetchRes.blockedReason,
    };
  }

  const { html, tier } = fetchRes;
  const text = htmlToPlainText(html, { selector: input.selector });
  const contentHash = hashText(text);
  const snippet = text.slice(0, SNIPPET_LEN);

  const lastCheckedAt = prev ? new Date(prev.checked_at).toISOString() : null;
  const changed = prev ? prev.content_hash !== contentHash : null;

  putWatch({
    key,
    url: input.url,
    selector: input.selector ?? null,
    content_hash: contentHash,
    snippet,
  });

  return { changed, tier, lastCheckedAt, snippet };
}
