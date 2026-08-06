import "server-only";

/**
 * NFR-12: minimal structured logging — one JSON line per event via
 * console.*, no new dependency. Vercel's log drains already parse
 * structured stdout/stderr lines, so this is enough without a logging
 * library. Scope is deliberately narrow: write paths, RPC failures, and
 * rate-limit events — not blanket instrumentation of read-only queries.
 */
type Level = "info" | "warn" | "error";

function log(level: Level, event: string, fields: Record<string, unknown> = {}) {
  const line = JSON.stringify({ level, event, ts: new Date().toISOString(), ...fields });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  info: (event: string, fields?: Record<string, unknown>) => log("info", event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => log("warn", event, fields),
  error: (event: string, fields?: Record<string, unknown>) => log("error", event, fields),
};
