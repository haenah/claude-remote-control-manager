/**
 * Housekeeping, hourly: delete session logs older than 14 days and expired
 * logins and invites. A `script` log of a long session runs to hundreds of MB.
 *
 * Nothing here tracks whether sessions are alive — that is read from the
 * provider state on demand, so there is nothing to sweep.
 */

import * as db from "./db";
import { sessionService } from "./sessions";

const PRUNE_MS = 3_600_000;
function housekeeping(): void {
  sessionService
    .maintain()
    .catch((e) => console.error("provider maintenance failed", e));
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
