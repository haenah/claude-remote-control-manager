/**
 * Housekeeping, hourly: delete session logs older than 14 days and expired
 * logins and invites. A `script` log of a long session runs to hundreds of MB.
 *
 * Nothing here tracks whether sessions are alive — that is read from the
 * process table on demand (claude-state.ts), so there is nothing to sweep.
 */

import { readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { sessionLogDir } from "./config";
import * as db from "./db";
import { processTable } from "./proc";

const PRUNE_MS = 3_600_000;
const LOG_RETENTION_DAYS = 14;

export async function pruneSessionLogs(nowMs = Date.now()): Promise<number> {
  let names: string[];
  try {
    names = readdirSync(sessionLogDir());
  } catch {
    return 0;
  }
  // A running session's log can go untouched for days and is still its link
  // source; its path is in the `script` process's argv.
  const keep = new Set<string>();
  for (const p of (await processTable()).values()) {
    const m = p.args.match(/\/(session-[0-9a-f]{12})\.log/);
    if (m) keep.add(m[1]!);
  }
  const cutoff = nowMs - LOG_RETENTION_DAYS * 86_400_000;
  let removed = 0;
  for (const name of names) {
    const m = name.match(/^(session-[0-9a-f]{12})(?:-.*)?\.(log|debug|err|pid)$/);
    if (!m || keep.has(m[1]!)) continue;
    const path = join(sessionLogDir(), name);
    try {
      if (statSync(path).mtimeMs < cutoff) {
        unlinkSync(path);
        removed++;
      }
    } catch {
      // Gone already.
    }
  }
  if (removed) console.info(`pruned ${removed} session log files older than ${LOG_RETENTION_DAYS}d`);
  return removed;
}

function housekeeping(): void {
  pruneSessionLogs().catch((e) => console.error("log prune failed", e));
  try {
    db.db.query("DELETE FROM auth_sessions WHERE expires_at < ?").run(db.now());
    db.db.query("DELETE FROM enroll_tokens WHERE expires_at < ?").run(db.now());
  } catch (e) {
    console.error("auth cleanup failed", e);
  }
}

export function startHousekeeping(): () => void {
  housekeeping();
  const t = setInterval(housekeeping, PRUNE_MS);
  return () => clearInterval(t);
}
