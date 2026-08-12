import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import { DATA_DIR } from "./constants.js";

const cacheDir = path.join(DATA_DIR, "cache");
fs.mkdirSync(cacheDir, { recursive: true });

const db = new Database(path.join(cacheDir, "watch.sqlite"));
db.exec(`
  CREATE TABLE IF NOT EXISTS watches (
    key TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    selector TEXT,
    content_hash TEXT NOT NULL,
    snippet TEXT NOT NULL,
    checked_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS crawled_pages (
    url TEXT PRIMARY KEY,
    markdown TEXT NOT NULL,
    title TEXT,
    fetched_at INTEGER NOT NULL
  );
`);

export function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function watchKey(url: string, selector?: string): string {
  return hashText(`${url}::${selector ?? ""}`);
}

export interface WatchRecord {
  key: string;
  url: string;
  selector: string | null;
  content_hash: string;
  snippet: string;
  checked_at: number;
}

export function getWatch(key: string): WatchRecord | undefined {
  return db.prepare("SELECT * FROM watches WHERE key = ?").get(key) as WatchRecord | undefined;
}

export function putWatch(rec: Omit<WatchRecord, "checked_at">) {
  db.prepare(
    `INSERT INTO watches (key, url, selector, content_hash, snippet, checked_at)
     VALUES (@key, @url, @selector, @content_hash, @snippet, @checked_at)
     ON CONFLICT(key) DO UPDATE SET
       content_hash=excluded.content_hash,
       snippet=excluded.snippet,
       checked_at=excluded.checked_at`
  ).run({ ...rec, checked_at: Date.now() });
}

export interface CrawledPageRecord {
  url: string;
  markdown: string;
  title: string | null;
  fetched_at: number;
}

export function getCrawledPage(url: string): CrawledPageRecord | undefined {
  return db.prepare("SELECT * FROM crawled_pages WHERE url = ?").get(url) as
    CrawledPageRecord | undefined;
}

export function putCrawledPage(url: string, markdown: string, title?: string | null) {
  db.prepare(
    `INSERT INTO crawled_pages (url, markdown, title, fetched_at)
     VALUES (@url, @markdown, @title, @fetched_at)
     ON CONFLICT(url) DO UPDATE SET
       markdown=excluded.markdown,
       title=excluded.title,
       fetched_at=excluded.fetched_at`
  ).run({ url, markdown, title: title ?? null, fetched_at: Date.now() });
}
