/**
 * SQLite — sign-in state and the last successful session start per directory.
 * Session details are read directly from Claude (see claude-state.ts).
 */

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { dbPath } from "./config";

export interface PasskeyRow {
  id: string;
  public_key: Uint8Array;
  counter: number;
  transports: string | null;
  device_type: string | null;
  backed_up: number;
  name: string;
  created_at: string;
  last_used_at: string | null;
}

mkdirSync(dirname(dbPath()), { recursive: true });
export const db = new Database(dbPath(), { create: true, strict: true });
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS passkeys (
  id           TEXT PRIMARY KEY,
  public_key   BLOB    NOT NULL,
  counter      INTEGER NOT NULL DEFAULT 0,
  transports   TEXT,
  device_type  TEXT,
  backed_up    INTEGER NOT NULL DEFAULT 0,
  name         TEXT    NOT NULL,
  created_at   TEXT    NOT NULL,
  last_used_at TEXT
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash   TEXT PRIMARY KEY,
  passkey_id   TEXT REFERENCES passkeys(id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  user_agent   TEXT
);

CREATE TABLE IF NOT EXISTS enroll_tokens (
  token_hash TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recent_projects (
  host            TEXT NOT NULL,
  path            TEXT NOT NULL,
  last_started_at TEXT NOT NULL,
  PRIMARY KEY (host, path)
);
`);

export const now = () => new Date().toISOString();

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

export function getMeta(key: string): string | null {
  return db.query<{ value: string }, [string]>("SELECT value FROM meta WHERE key = ?").get(key)?.value ?? null;
}

export function setMeta(key: string, value: string): void {
  db.query("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(key, value);
}
