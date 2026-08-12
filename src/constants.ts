/**
 * Shared constants for mcp-web-agent.
 * Centralised here so the User-Agent string is never duplicated across
 * tieredFetch, browserPool, and hostGate.
 */

export const USER_AGENT =
  "Mozilla/5.0 (compatible; mcp-web-agent/1.0; +https://github.com/creatorpiyush/mcp-web-agent)";

/**
 * Root directory for all runtime data files (cache DB, session JSON).
 * Controlled via MCP_WEB_AGENT_DATA_DIR; defaults to .mcp-web-agent/ in
 * the current working directory so data never lands inside node_modules.
 */
export const DATA_DIR: string =
  process.env["MCP_WEB_AGENT_DATA_DIR"] ?? `${process.cwd()}/.mcp-web-agent`;
