import { scrape } from "./tools/scrape.js";
import { check } from "./tools/check.js";
import { diff } from "./tools/diff.js";
import { crawl } from "./tools/crawl.js";
import { crawlGetPage } from "./tools/crawlGetPage.js";
import { interact } from "./tools/interact.js";
import { deleteSession, loadSession, saveSession } from "./sessions.js";
import { checkRobots, SimpleRobotsParser } from "./hostGate.js";
import { browserPool } from "./browserPool.js";

function banner(title: string) {
  console.log(`\n============================================================`);
  console.log(`TEST: ${title}`);
  console.log(`============================================================`);
}

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${msg}`);
    throw new Error(`Test assertion failed: ${msg}`);
  }
  console.log(`✅ PASS: ${msg}`);
}

// In-memory Mock Fetch to bypass sandboxed network limitations during automated tests
const originalFetch = globalThis.fetch;

function setupMockFetch() {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const urlStr =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

    if (urlStr.includes("test-server.local/robots.txt")) {
      return new Response(`User-agent: *\nDisallow: /blocked-page\nCrawl-delay: 1`, {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    }
    if (urlStr.includes("test-server.local/blocked-page")) {
      return new Response(
        `<html><body><h1>Blocked Page</h1><p>You should not see this. This page is intended to test robots.txt disallow rules enforcement across scraping and crawling components in mcp-web-agent.</p></body></html>`,
        { status: 200, headers: { "Content-Type": "text/html" } }
      );
    }
    if (urlStr.includes("test-server.local/page-a")) {
      return new Response(
        `<html><head><title>Page A</title></head><body><h1>Welcome to Page A</h1><p>This is the full text content for Page A used in automated test cases for mcp-web-agent BFS crawling and link extraction.</p><a href="http://test-server.local/page-b">Page B</a></body></html>`,
        { status: 200, headers: { "Content-Type": "text/html" } }
      );
    }
    if (urlStr.includes("test-server.local/page-b")) {
      return new Response(
        `<html><head><title>Page B</title></head><body><h1>Welcome to Page B</h1><p>This is page B content used in automated test cases for mcp-web-agent BFS crawling and link extraction tools.</p></body></html>`,
        { status: 200, headers: { "Content-Type": "text/html" } }
      );
    }
    if (urlStr.includes("test-server.local")) {
      return new Response(
        `<html><head><title>Home Page</title></head><body><h1>Main Heading</h1><p>Welcome to our test server for mcp-web-agent testing. This contains enough text to satisfy the static fetch tier without escalating to Chromium.</p><a href="http://test-server.local/page-a">Page A</a></body></html>`,
        { status: 200, headers: { "Content-Type": "text/html" } }
      );
    }

    return originalFetch(input, init);
  }) as typeof fetch;
}

async function runTests() {
  setupMockFetch();
  const baseUrl = `http://test-server.local`;

  try {
    // --- Test 1: SimpleRobotsParser & Host Gate ---
    banner("Host Gate & Robots.txt Parsing");
    const sampleRobots = `
      User-agent: *
      Disallow: /private/
      Disallow: /admin
      Allow: /private/public-subfolder
      Crawl-delay: 2
    `;
    const parser = new SimpleRobotsParser(sampleRobots);
    assert(
      parser.isAllowed("http://test-server.local/index.html", "mcp-web-agent") === true,
      "Allowed root path"
    );
    assert(
      parser.isAllowed("http://test-server.local/private/secret", "mcp-web-agent") === false,
      "Disallowed /private/"
    );
    assert(
      parser.isAllowed(
        "http://test-server.local/private/public-subfolder/page",
        "mcp-web-agent"
      ) === true,
      "Allowed specific subpath"
    );
    assert(parser.getCrawlDelay("mcp-web-agent") === 2, "Crawl-delay parsed correctly");

    const robotsAllowed = await checkRobots(`${baseUrl}/`);
    assert(robotsAllowed.allowed === true, "Live checkRobots allowed on root");

    const robotsBlocked = await checkRobots(`${baseUrl}/blocked-page`);
    assert(robotsBlocked.allowed === false, "Live checkRobots disallowed on /blocked-page");

    // --- Test 2: web_scrape with robots compliance ---
    banner("web_scrape Tool & Robots Enforcement");
    const scrapeBlocked = await scrape({ url: `${baseUrl}/blocked-page` });
    assert(scrapeBlocked.blocked === true, "scrape blocked by robots.txt");

    const scrapeIgnored = await scrape({ url: `${baseUrl}/blocked-page`, ignoreRobots: true });
    assert(
      scrapeIgnored.blocked !== true && (scrapeIgnored.content as string).includes("Blocked Page"),
      "scrape ignoreRobots bypassed block"
    );

    const scrapeRes = await scrape({ url: `${baseUrl}/` });
    assert(scrapeRes.tier === "static", "Static tier used for local HTTP fetch");
    assert(
      (scrapeRes.content as string).includes("Main Heading"),
      "Extracted markdown contains heading"
    );

    const scrapeJsonRes = await scrape({
      url: `${baseUrl}/`,
      format: "json",
      schema: { heading: "h1", paragraph: "p" },
    });
    assert(scrapeJsonRes.format === "json", "JSON format returned");
    const jsonContent = scrapeJsonRes.content as Record<string, string | null>;
    assert(jsonContent.heading === "Main Heading", "Extracted heading field");

    // --- Test 3: web_check ---
    banner("web_check Tool");
    const checkContains = await check({
      url: `${baseUrl}/`,
      assertion: "contains",
      value: "test server",
    });
    assert(checkContains.pass === true, "Contains assertion passed");
    assert(checkContains.evidence.includes("test server"), "Evidence snippet provided");

    const checkSelector = await check({
      url: `${baseUrl}/`,
      assertion: "selector_exists",
      value: "h1",
    });
    assert(checkSelector.pass === true, "Selector exists assertion passed");

    const checkNotExists = await check({
      url: `${baseUrl}/`,
      assertion: "selector_not_exists",
      value: ".nonexistent",
    });
    assert(checkNotExists.pass === true, "Selector not exists assertion passed");

    // --- Test 4: web_diff ---
    banner("web_diff Tool");
    const diffUrl = `${baseUrl}/diff-page-${Date.now()}`;
    const diff1 = await diff({ url: diffUrl });
    assert(diff1.changed === null, "First check returns changed: null");
    assert(diff1.snippet.includes("Main Heading"), "Snippet populated on first check");

    const diff2 = await diff({ url: diffUrl });
    assert(diff2.changed === false, "Subsequent check on unchanged content returns changed: false");

    // --- Test 5: web_crawl & web_crawl_get_page ---
    banner("web_crawl & web_crawl_get_page Tools");
    const crawlRes = await crawl({
      startUrl: `${baseUrl}/`,
      maxDepth: 2,
      maxPages: 5,
      contentDepth: "summary",
    });
    console.log(
      "Crawl pages visited:",
      crawlRes.pages.map((p) => ({ url: p.url, depth: p.depth }))
    );
    assert(crawlRes.totalPagesVisited >= 3, "Crawl visited root, page-a, and page-b");
    const pageA = crawlRes.pages.find((p) => p.url.includes("/page-a"));
    assert(pageA !== undefined && pageA.title === "Page A", "Page A discovered with title");

    const pageBCached = await crawlGetPage({ url: `${baseUrl}/page-b` });
    assert(
      pageBCached.markdown.includes("This is page B content"),
      "Retrieved cached full markdown for Page B"
    );
    assert(pageBCached.fetchedAt.length > 0, "FetchedAt timestamp present");

    // --- Test 6: Session Storage & Management ---
    banner("Session Storage & Management");
    const testSessionId = "test-session-123";
    await deleteSession(testSessionId);
    assert((await loadSession(testSessionId)) === undefined, "Session initially undefined");

    const mockStorageState = { cookies: [{ name: "session_token", value: "abc123xyz" }] };
    await saveSession(testSessionId, mockStorageState);
    const loaded = await loadSession(testSessionId);
    assert(
      loaded !== undefined && (loaded as any).cookies[0].name === "session_token",
      "Session storageState saved & loaded correctly"
    );

    await deleteSession(testSessionId);
    assert(
      (await loadSession(testSessionId)) === undefined,
      "Session deleted via deleteSession / web_session_close"
    );

    // --- Test 7: web_interact (live Playwright browser) ---
    banner("web_interact Tool Execution");
    try {
      // Use a real, stable public URL so the browser tier actually navigates.
      // example.com is the IANA-reserved demonstration domain — guaranteed stable.
      const result = await interact({
        url: "https://example.com",
        actions: [{ type: "waitFor", selector: "h1" }],
      });
      assert(result.ariaSnapshot.length > 0, "ARIA snapshot returned from live page");
      assert(result.finalUrl.includes("example.com"), "finalUrl reflects the real page");
      console.log("✅ PASS: ARIA snapshot returned from live page");
      console.log("✅ PASS: finalUrl reflects the real page");
    } catch (err: any) {
      const msg: string = err.message ?? "";
      const isEnvIssue =
        msg.includes("Chromium") ||
        msg.includes("sandbox") ||
        msg.includes("launch") ||
        msg.includes("ERR_NAME_NOT_RESOLVED") ||
        msg.includes("ERR_INTERNET_DISCONNECTED") ||
        msg.includes("net::");
      if (isEnvIssue) {
        console.log(
          "ℹ️ Playwright browser test skipped (no browser / no network access in this environment)."
        );
      } else {
        throw err;
      }
    }

    banner("ALL TESTS COMPLETED SUCCESSFULLY! 🎉");
  } finally {
    globalThis.fetch = originalFetch;
    await browserPool.shutdown();
  }
}

runTests().catch(async (err) => {
  console.error("❌ Test suite failed:", err);
  globalThis.fetch = originalFetch;
  await browserPool.shutdown();
  process.exit(1);
});
