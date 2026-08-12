import { tieredFetch } from "../tieredFetch.js";
import { htmlToPlainText } from "../extract.js";
import * as cheerio from "cheerio";

export type AssertionType =
  "contains" | "not_contains" | "selector_exists" | "selector_not_exists" | "text_equals";

export interface CheckInput {
  url: string;
  assertion: AssertionType;
  /** text to look for (contains/not_contains/text_equals) or CSS selector (selector_exists/_not_exists) */
  value: string;
  /** for text_equals/contains, optionally scope the text search to a subtree */
  selector?: string;
  forceBrowser?: boolean;
  ignoreRobots?: boolean;
}

export interface CheckOutput {
  pass: boolean;
  tier: "static" | "browser";
  /** short (<=200 char) evidence snippet, not the whole page — this is the point */
  evidence: string;
  blocked?: boolean;
  blockedReason?: string;
}

const EVIDENCE_WINDOW = 100;

function snippetAround(text: string, needle: string): string {
  const idx = text.toLowerCase().indexOf(needle.toLowerCase());
  if (idx === -1) return text.slice(0, EVIDENCE_WINDOW * 2);
  const start = Math.max(0, idx - EVIDENCE_WINDOW);
  const end = Math.min(text.length, idx + needle.length + EVIDENCE_WINDOW);
  return (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
}

export async function check(input: CheckInput): Promise<CheckOutput> {
  const fetchRes = await tieredFetch(input.url, {
    forceBrowser: input.forceBrowser,
    ignoreRobots: input.ignoreRobots,
  });

  if (fetchRes.blocked) {
    return {
      pass: false,
      tier: fetchRes.tier,
      evidence: fetchRes.blockedReason ?? "Blocked by robots.txt",
      blocked: true,
      blockedReason: fetchRes.blockedReason,
    };
  }

  const { html, tier } = fetchRes;

  if (input.assertion === "selector_exists" || input.assertion === "selector_not_exists") {
    const $ = cheerio.load(html);
    const exists = $(input.value).length > 0;
    const pass = input.assertion === "selector_exists" ? exists : !exists;
    return {
      pass,
      tier,
      evidence: exists
        ? `selector "${input.value}" matched ${$(input.value).length} element(s)`
        : `selector "${input.value}" not found`,
    };
  }

  const text = htmlToPlainText(html, { selector: input.selector });

  if (input.assertion === "contains") {
    const found = text.toLowerCase().includes(input.value.toLowerCase());
    return { pass: found, tier, evidence: snippetAround(text, input.value) };
  }
  if (input.assertion === "not_contains") {
    const found = text.toLowerCase().includes(input.value.toLowerCase());
    return {
      pass: !found,
      tier,
      evidence: found ? snippetAround(text, input.value) : "(not present, as expected)",
    };
  }
  if (input.assertion === "text_equals") {
    const pass = text.trim() === input.value.trim();
    return { pass, tier, evidence: text.slice(0, EVIDENCE_WINDOW * 2) };
  }

  throw new Error(`Unknown assertion type: ${input.assertion}`);
}
