import fs from "node:fs";
import path from "node:path";
import { hashText } from "./cache.js";
import { DATA_DIR } from "./constants.js";
import type { BrowserContextOptions } from "playwright-core";

type StorageState = Exclude<BrowserContextOptions["storageState"], string | undefined>;

const sessionsDir = path.join(DATA_DIR, "sessions");
fs.mkdirSync(sessionsDir, { recursive: true });

function getSessionFilePath(sessionId: string): string {
  const hash = hashText(sessionId);
  return path.join(sessionsDir, `${hash}.json`);
}

/**
 * Loads Playwright storageState from disk for a given sessionId.
 */
export async function loadSession(sessionId: string): Promise<StorageState | undefined> {
  const filePath = getSessionFilePath(sessionId);
  try {
    const raw = await fs.promises.readFile(filePath, "utf-8");
    return JSON.parse(raw) as StorageState;
  } catch {
    return undefined;
  }
}

/**
 * Saves Playwright storageState to disk atomically using a temp file.
 */
export async function saveSession(sessionId: string, state: unknown): Promise<void> {
  const filePath = getSessionFilePath(sessionId);
  const tmpPath = `${filePath}.${Date.now()}.tmp`;
  const content = JSON.stringify(state, null, 2);

  await fs.promises.writeFile(tmpPath, content, "utf-8");
  await fs.promises.rename(tmpPath, filePath);
}

/**
 * Deletes a session state file from disk.
 */
export async function deleteSession(sessionId: string): Promise<void> {
  const filePath = getSessionFilePath(sessionId);
  try {
    await fs.promises.unlink(filePath);
  } catch {
    // Ignore if file doesn't exist
  }
}

/**
 * Sweeps the .sessions directory and prunes session files untouched for > 7 days.
 */
export async function pruneOldSessions(maxAgeMs = 7 * 24 * 60 * 60 * 1000): Promise<void> {
  try {
    const files = await fs.promises.readdir(sessionsDir);
    const now = Date.now();
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const filePath = path.join(sessionsDir, file);
      try {
        const stats = await fs.promises.stat(filePath);
        if (now - stats.mtimeMs > maxAgeMs) {
          await fs.promises.unlink(filePath);
        }
      } catch {
        // Ignore individual file errors during sweep
      }
    }
  } catch {
    // Ignore sweep directory errors
  }
}

// Run prune on module import / startup
pruneOldSessions().catch(() => {});
