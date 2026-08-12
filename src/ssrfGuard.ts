import dns from "node:dns/promises";
import net from "node:net";

/** Ranges that should never be reachable via an agent-driven fetch. */
function isPrivateOrReservedIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true; // fail closed on garbage
  const [a, b] = parts;
  return (
    a === 127 || // loopback
    a === 10 || // private
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 192 && b === 168) || // private
    (a === 169 && b === 254) || // link-local incl. cloud metadata
    a === 0 || // "this network"
    a >= 224 // multicast/reserved
  );
}

function isPrivateOrReservedIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  return (
    lower === "::1" || // loopback
    lower.startsWith("fe80") || // link-local
    lower.startsWith("fc") || // unique local
    lower.startsWith("fd") || // unique local
    lower.startsWith("::ffff:127.") || // IPv4-mapped loopback
    lower.startsWith("::ffff:10.") ||
    lower.startsWith("::ffff:192.168.") ||
    lower.startsWith("::ffff:169.254.")
  );
}

function isBlockedIP(ip: string): boolean {
  return net.isIP(ip) === 4 ? isPrivateOrReservedIPv4(ip) : isPrivateOrReservedIPv6(ip);
}

/**
 * Throws if `urlStr` resolves to a loopback/private/link-local address,
 * or uses a scheme other than http/https. Call this immediately before
 * every outbound fetch() or page.goto() — including ones triggered by
 * following links discovered during a crawl.
 *
 * NOTE: DNS rebinding is not fully mitigated — the guard closes the common
 * case (naive links to 169.254.169.254, localhost, RFC-1918 ranges) but a
 * determined attacker can still exploit the gap between this DNS lookup and
 * the TCP connection. Rebinding-proof hardening (IP pinning via a custom
 * dispatcher or local proxy) is a follow-up for high-trust-boundary deployments.
 */
export async function assertPublicUrl(urlStr: string): Promise<void> {
  const url = new URL(urlStr);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Blocked: unsupported protocol "${url.protocol}"`);
  }

  // Literal IP in the URL — check directly, no DNS involved.
  if (net.isIP(url.hostname)) {
    if (isBlockedIP(url.hostname)) {
      throw new Error(`Blocked: "${url.hostname}" is a private/reserved address`);
    }
    return;
  }

  if (url.hostname === "localhost") {
    throw new Error(`Blocked: "localhost" is not allowed`);
  }

  // Resolve and check every address the hostname maps to — a hostname
  // can have multiple A/AAAA records, and an attacker only needs one
  // of them to point somewhere sensitive.
  let addresses: { address: string; family: number }[];
  try {
    addresses = await dns.lookup(url.hostname, { all: true });
  } catch {
    throw new Error(`Blocked: could not resolve "${url.hostname}"`);
  }

  for (const { address } of addresses) {
    if (isBlockedIP(address)) {
      throw new Error(`Blocked: "${url.hostname}" resolves to a private/reserved address`);
    }
  }
}

/**
 * Indirection object so tests can replace `assertPublicUrl` with a no-op
 * without patching the module system:
 *
 *   import { ssrfGuard } from "./ssrfGuard.js";
 *   ssrfGuard.assertPublicUrl = async () => {};
 *
 * All internal callers use `ssrfGuard.assertPublicUrl(...)` instead of the
 * bare function so the replacement takes effect everywhere.
 */
export const ssrfGuard = {
  assertPublicUrl,
};
