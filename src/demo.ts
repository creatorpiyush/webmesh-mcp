import { scrape } from "./tools/scrape.js";
import { check } from "./tools/check.js";
import { diff } from "./tools/diff.js";
import { browserPool } from "./browserPool.js";

function section(title: string) {
  console.log(`\n${"=".repeat(60)}\n${title}\n${"=".repeat(60)}`);
}

async function main() {
  const url = process.argv[2] ?? "https://github.com/anthropics";

  section(`web_scrape (markdown) — ${url}`);
  const s = await scrape({ url, format: "markdown" });
  console.log(`tier: ${s.tier}`);
  console.log(`chars saved vs raw HTML: ${s.approxCharsSaved.toLocaleString()}`);
  console.log(`markdown length: ${(s.content as string).length.toLocaleString()} chars`);
  console.log("--- first 500 chars ---");
  console.log((s.content as string).slice(0, 500));

  section(`web_check (contains) — ${url}`);
  const c = await check({ url, assertion: "contains", value: "Anthropic" });
  console.log(JSON.stringify(c, null, 2));

  section(`web_diff (first check, then re-check) — ${url}`);
  const d1 = await diff({ url });
  console.log("first check:", JSON.stringify(d1, null, 2));
  const d2 = await diff({ url });
  console.log("second check (should be changed:false, same content):", JSON.stringify(d2, null, 2));

  await browserPool.shutdown();
}

main().catch(async (err) => {
  console.error("Demo failed:", err);
  await browserPool.shutdown();
  process.exit(1);
});
