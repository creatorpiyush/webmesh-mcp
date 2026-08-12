import { USER_AGENT } from "./constants.js";

const ROBOTS_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface RuleGroup {
  userAgents: string[];
  disallow: string[];
  allow: string[];
  crawlDelay?: number;
}

export class SimpleRobotsParser {
  private groups: RuleGroup[] = [];

  constructor(content: string) {
    this.parse(content);
  }

  private parse(content: string) {
    const lines = content.split(/\r?\n/);
    let currentGroup: RuleGroup | null = null;

    for (const rawLine of lines) {
      const line = rawLine.replace(/#.*/, "").trim();
      if (!line) continue;

      const colonIdx = line.indexOf(":");
      if (colonIdx === -1) continue;

      const field = line.slice(0, colonIdx).trim().toLowerCase();
      const value = line.slice(colonIdx + 1).trim();

      if (field === "user-agent") {
        if (
          !currentGroup ||
          currentGroup.disallow.length > 0 ||
          currentGroup.allow.length > 0 ||
          currentGroup.crawlDelay !== undefined
        ) {
          currentGroup = { userAgents: [], disallow: [], allow: [] };
          this.groups.push(currentGroup);
        }
        currentGroup.userAgents.push(value.toLowerCase());
      } else if (currentGroup) {
        if (field === "disallow") {
          if (value) currentGroup.disallow.push(value);
        } else if (field === "allow") {
          if (value) currentGroup.allow.push(value);
        } else if (field === "crawl-delay") {
          const num = parseFloat(value);
          if (!isNaN(num)) currentGroup.crawlDelay = num;
        }
      }
    }
  }

  private findMatchingGroup(ua: string): RuleGroup | undefined {
    const uaLower = ua.toLowerCase();
    let best = this.groups.find((g) => g.userAgents.some((u) => u !== "*" && uaLower.includes(u)));
    if (!best) {
      best = this.groups.find((g) => g.userAgents.includes("*"));
    }
    return best;
  }

  isAllowed(urlStr: string, userAgent: string): boolean {
    try {
      const pathname = new URL(urlStr).pathname;
      const group = this.findMatchingGroup(userAgent);
      if (!group) return true;

      const matchesRule = (rulePath: string) => {
        if (!rulePath) return false;
        const pattern = rulePath.replace(/\*/g, ".*");
        return new RegExp("^" + pattern).test(pathname);
      };

      const matchingAllows = group.allow.filter(matchesRule);
      const matchingDisallows = group.disallow.filter(matchesRule);

      const longestAllow = matchingAllows.reduce((max, r) => (r.length > max ? r.length : max), 0);
      const longestDisallow = matchingDisallows.reduce(
        (max, r) => (r.length > max ? r.length : max),
        0
      );

      if (longestAllow > 0 || longestDisallow > 0) {
        return longestAllow >= longestDisallow;
      }
      return true;
    } catch {
      return true;
    }
  }

  getCrawlDelay(userAgent: string): number | undefined {
    const group = this.findMatchingGroup(userAgent);
    return group?.crawlDelay;
  }
}

class SimpleHostQueue {
  private queue: (() => void)[] = [];
  private lastExec = 0;
  private timer: NodeJS.Timeout | null = null;
  private intervalMs: number;

  constructor(intervalMs: number) {
    this.intervalMs = intervalMs;
  }

  add<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push(() => {
        fn().then(resolve, reject);
      });
      this.process();
    });
  }

  private process() {
    if (this.timer) return;
    const now = Date.now();
    const wait = Math.max(0, this.intervalMs - (now - this.lastExec));

    this.timer = setTimeout(() => {
      this.timer = null;
      const task = this.queue.shift();
      if (task) {
        this.lastExec = Date.now();
        task();
      }
      if (this.queue.length > 0) {
        this.process();
      }
    }, wait);
  }
}

interface RobotsCacheEntry {
  robots: SimpleRobotsParser;
  fetchedAt: number;
}

const robotsCache = new Map<string, RobotsCacheEntry>();
const hostQueues = new Map<string, SimpleHostQueue>();

export interface CheckRobotsResult {
  allowed: boolean;
  crawlDelayMs?: number;
}

export async function checkRobots(
  url: string,
  userAgent: string = USER_AGENT
): Promise<CheckRobotsResult> {
  try {
    const parsedUrl = new URL(url);
    const origin = parsedUrl.origin;
    const robotsUrl = `${origin}/robots.txt`;

    let entry = robotsCache.get(origin);
    if (!entry || Date.now() - entry.fetchedAt > ROBOTS_CACHE_TTL_MS) {
      try {
        const res = await fetch(robotsUrl, {
          headers: { "User-Agent": USER_AGENT },
          signal: AbortSignal.timeout(5000),
        });
        const txt = res.ok ? await res.text() : "";
        entry = {
          robots: new SimpleRobotsParser(txt),
          fetchedAt: Date.now(),
        };
        robotsCache.set(origin, entry);
      } catch {
        // Don't cache network failures in robotsCache so subsequent requests can retry
        return { allowed: true };
      }
    }

    const allowed = entry.robots.isAllowed(url, userAgent);
    const delaySec = entry.robots.getCrawlDelay(userAgent);

    return {
      allowed,
      crawlDelayMs: delaySec ? delaySec * 1000 : undefined,
    };
  } catch {
    return { allowed: true };
  }
}

export async function schedule<T>(
  hostname: string,
  fn: () => Promise<T>,
  crawlDelayMs?: number
): Promise<T> {
  const minInterval = Math.max(250, crawlDelayMs ?? 250);
  let q = hostQueues.get(hostname);
  if (!q) {
    q = new SimpleHostQueue(minInterval);
    hostQueues.set(hostname, q);
  }
  return q.add(fn);
}
