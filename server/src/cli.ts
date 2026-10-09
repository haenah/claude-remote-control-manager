/**
 * Server-side recovery, for when no signed-in device is at hand:
 *
 *   bun run cli invite           one-time code (30 min) to register a new passkey
 *   bun run cli passkeys         list registered passkeys
 *   bun run cli reset-passkeys   delete every passkey and login; prints a setup code
 */

import { db } from "./db";
import { createEnrollToken, ensureBootstrapToken } from "./auth/store";

const [cmd] = process.argv.slice(2);

switch (cmd) {
  case "invite": {
    const { token, expiresAt } = createEnrollToken(30 * 60_000);
    console.log(`Setup code: ${token}\nValid until ${expiresAt}`);
    break;
  }
  case "passkeys": {
    const rows = db
      .query<{ name: string; created_at: string; last_used_at: string | null }, []>(
        "SELECT name, created_at, last_used_at FROM passkeys ORDER BY created_at",
      )
      .all();
    if (!rows.length) console.log("No passkeys registered.");
    for (const r of rows) console.log(`${r.name}\tcreated ${r.created_at}\tlast used ${r.last_used_at ?? "never"}`);
    break;
  }
  case "reset-passkeys": {
    db.query("DELETE FROM auth_sessions").run();
    db.query("DELETE FROM passkeys").run();
    ensureBootstrapToken();
    break;
  }
  default:
    console.log("usage: bun run cli <invite|passkeys|reset-passkeys>");
    process.exit(cmd ? 1 : 0);
}
