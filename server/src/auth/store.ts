/**
 * Auth state: login sessions, one-time enrollment tokens and WebAuthn challenges.
 *
 * There is exactly one user. Who may register a passkey:
 *  - someone already signed in (adding this device's passkey), or
 *  - someone holding an enrollment token: the bootstrap token printed at
 *    startup while no passkey exists, or an invite minted from a signed-in
 *    device for a new one.
 * Everyone else can only sign in with an existing passkey.
 */

import { createHash, randomBytes, randomInt } from "node:crypto";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { config, dataDir } from "../config";
import { db, getMeta, now, setMeta } from "../db";

export const SESSION_COOKIE = "rcm_session";

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

// ---------------------------------------------------------------------------
// WebAuthn user handle
// ---------------------------------------------------------------------------

/** The single user's stable WebAuthn user handle. */
export function userId(): Uint8Array<ArrayBuffer> {
  let id = getMeta("webauthn_user_id");
  if (!id) {
    id = randomBytes(32).toString("base64url");
    setMeta("webauthn_user_id", id);
  }
  return new Uint8Array(Buffer.from(id, "base64url"));
}

export function passkeyCount(): number {
  return db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM passkeys").get()!.n;
}

// ---------------------------------------------------------------------------
// Enrollment tokens
// ---------------------------------------------------------------------------

// No 0/O/1/I/L — these get read off a terminal and typed on a phone.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** Canonical form: uppercase, separators dropped, so "abcd-efgh" == "ABCDEFGH". */
const canonical = (token: string) => token.toUpperCase().replace(/[^A-Z0-9]/g, "");

export function createEnrollToken(ttlMs: number): { token: string; expiresAt: string } {
  // 16 chars × log2(31) ≈ 79 bits.
  const raw = Array.from({ length: 16 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  const token = raw.match(/.{4}/g)!.join("-");
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  db.query("INSERT INTO enroll_tokens (token_hash, created_at, expires_at) VALUES (?, ?, ?)").run(
    sha256(canonical(raw)),
    now(),
    expiresAt,
  );
  return { token, expiresAt };
}

/** Hash of *token* if it is a live enrollment token, else null. */
export function checkEnrollToken(token: string | undefined | null): string | null {
  if (!token) return null;
  const hash = sha256(canonical(token));
  const row = db
    .query<{ token_hash: string }, [string, string]>(
      "SELECT token_hash FROM enroll_tokens WHERE token_hash = ? AND expires_at > ?",
    )
    .get(hash, now());
  return row ? hash : null;
}

export function enrollTokenLive(hash: string): boolean {
  return !!db
    .query("SELECT 1 FROM enroll_tokens WHERE token_hash = ? AND expires_at > ?")
    .get(hash, now());
}

export function consumeEnrollToken(hash: string): void {
  db.query("DELETE FROM enroll_tokens WHERE token_hash = ?").run(hash);
}

const setupTokenFile = () => join(dataDir(), "setup-token");

/**
 * While no passkey exists, mint a 24h bootstrap token and show it in the log
 * and in <dataDir>/setup-token, so whoever can read this machine's files can
 * register the first passkey — and nobody else can.
 */
export function ensureBootstrapToken(): void {
  if (passkeyCount() > 0) {
    try {
      unlinkSync(setupTokenFile());
    } catch {
      // Not there.
    }
    return;
  }
  db.query("DELETE FROM enroll_tokens").run();
  const { token, expiresAt } = createEnrollToken(24 * 3_600_000);
  writeFileSync(setupTokenFile(), `${token}\n`, { mode: 0o600 });
  console.info(
    `\n  No passkey registered yet.\n  Setup token: ${token}\n  Valid until ${expiresAt} — also saved to ${setupTokenFile()}\n`,
  );
}

// ---------------------------------------------------------------------------
// Login sessions
// ---------------------------------------------------------------------------

export interface AuthSessionRow {
  token_hash: string;
  passkey_id: string | null;
  created_at: string;
  expires_at: string;
  last_seen_at: string;
  user_agent: string | null;
}

const sessionMs = () => config.auth.sessionDays * 86_400_000;

export function createAuthSession(passkeyId: string, userAgent: string | undefined): string {
  const token = randomBytes(32).toString("base64url");
  db.query(
    "INSERT INTO auth_sessions (token_hash, passkey_id, created_at, expires_at, last_seen_at, user_agent) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(sha256(token), passkeyId, now(), new Date(Date.now() + sessionMs()).toISOString(), now(), userAgent ?? null);
  return token;
}

/**
 * The live session for a cookie value, or null. Sliding expiry: a session in
 * use is pushed forward (at most once an hour, to keep writes rare).
 */
export function validateAuthSession(token: string | undefined): AuthSessionRow | null {
  if (!token) return null;
  const hash = sha256(token);
  const row = db
    .query<AuthSessionRow, [string, string]>("SELECT * FROM auth_sessions WHERE token_hash = ? AND expires_at > ?")
    .get(hash, now());
  if (!row) return null;
  if (Date.now() - Date.parse(row.last_seen_at) > 3_600_000) {
    db.query("UPDATE auth_sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?").run(
      now(),
      new Date(Date.now() + sessionMs()).toISOString(),
      hash,
    );
  }
  return row;
}

export function destroyAuthSession(token: string | undefined): void {
  if (token) db.query("DELETE FROM auth_sessions WHERE token_hash = ?").run(sha256(token));
}

/** Sign out every other device; returns how many sessions went. */
export function destroyOtherSessions(keepHash: string): number {
  return db.query("DELETE FROM auth_sessions WHERE token_hash != ?").run(keepHash).changes;
}

// ---------------------------------------------------------------------------
// Challenges
// ---------------------------------------------------------------------------

export interface PendingChallenge {
  kind: "register" | "login";
  expires: number;
  /** Registration authorised by an enrollment token rather than a login. */
  enrollHash?: string | null;
}

const CHALLENGE_TTL_MS = 5 * 60_000;
const challenges = new Map<string, PendingChallenge>();

export function rememberChallenge(challenge: string, c: Omit<PendingChallenge, "expires">): void {
  const t = Date.now();
  for (const [k, v] of challenges) if (v.expires < t) challenges.delete(k);
  challenges.set(challenge, { ...c, expires: t + CHALLENGE_TTL_MS });
}

/** Single use: a challenge is gone once taken, whether or not verification succeeds. */
export function takeChallenge(challenge: string, kind: PendingChallenge["kind"]): PendingChallenge | null {
  const c = challenges.get(challenge);
  challenges.delete(challenge);
  return c && c.kind === kind && c.expires > Date.now() ? c : null;
}

/** The challenge a browser signed, read from the response's clientDataJSON. */
export function challengeOf(response: { response?: { clientDataJSON?: string } }): string | null {
  try {
    const json = JSON.parse(Buffer.from(response.response!.clientDataJSON!, "base64url").toString("utf8"));
    return typeof json.challenge === "string" ? json.challenge : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Failure throttle
// ---------------------------------------------------------------------------

// One user, so a global window is enough: a burst of failed sign-ins or bad
// tokens from anywhere slows everyone down, including an attacker.
const FAIL_WINDOW_MS = 10 * 60_000;
const FAIL_LIMIT = 20;
const failures: number[] = [];

export function throttled(): boolean {
  const cutoff = Date.now() - FAIL_WINDOW_MS;
  while (failures.length && failures[0]! < cutoff) failures.shift();
  return failures.length >= FAIL_LIMIT;
}

export function recordFailure(): void {
  failures.push(Date.now());
}
