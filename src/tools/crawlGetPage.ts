import { getCrawledPage } from "../cache.js";

export interface CrawlGetPageInput {
  url: string;
}

export interface CrawlGetPageOutput {
  url: string;
  markdown: string;
  title: string | null;
  fetchedAt: string;
}

export async function crawlGetPage(input: CrawlGetPageInput): Promise<CrawlGetPageOutput> {
  const record = getCrawledPage(input.url);
  if (!record) {
    throw new Error(
      `No cached crawl content found for URL "${input.url}". Run web_crawl first to discover and cache this page.`
    );
  }

  return {
    url: record.url,
    markdown: record.markdown,
    title: record.title,
    fetchedAt: new Date(record.fetched_at).toISOString(),
  };
}
