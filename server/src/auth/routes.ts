/**
 * Passkey (WebAuthn) sign-in. Passkeys are discoverable and require user
 * verification, so signing in is one Face ID / Touch ID prompt — no username.
 */

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import type { Context, MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { userInfo } from "node:os";
import { config } from "../config";
import { db, now, type PasskeyRow } from "../db";
import { HttpError } from "../http";
import {
  SESSION_COOKIE,
  challengeOf,
  checkEnrollToken,
  consumeEnrollToken,
  createAuthSession,
  createEnrollToken,
  destroyAuthSession,
  destroyOtherSessions,
  enrollTokenLive,
  passkeyCount,
  recordFailure,
  rememberChallenge,
  takeChallenge,
  throttled,
  userId,
  validateAuthSession,
  type AuthSessionRow,
} from "./store";

export type AuthEnv = { Variables: { auth: AuthSessionRow | null } };

/** The request's Origin if it is one the UI is served from, else null. */
export function allowedOrigin(c: Context): string | null {
  const origin = c.req.header("origin");
  return origin && config.auth.origins.includes(origin) ? origin : null;
}

function requireOrigin(c: Context): { origin: string; rpID: string } {
  const origin = allowedOrigin(c);
  if (!origin) throw new HttpError(403, "Origin not allowed");
  return { origin, rpID: new URL(origin).hostname };
}

function setSessionCookie(c: Context, token: string, origin: string): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: origin.startsWith("https:"),
    sameSite: "Strict",
    path: "/",
    maxAge: config.auth.sessionDays * 86_400,
  });
}

function guardThrottle(): void {
  if (throttled()) throw new HttpError(429, "Too many failed attempts — try again in a few minutes");
}

/** A readable default name for a passkey, from the registering browser. */
function deviceName(ua: string | undefined): string {
  if (!ua) return "Passkey";
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows";
  return "Passkey";
}

const listPasskeys = () => db.query<PasskeyRow, []>("SELECT * FROM passkeys ORDER BY created_at").all();

/** Attach the login session (if any) to every request. */
export const loadAuth: MiddlewareHandler<AuthEnv> = async (c, next) => {
  c.set("auth", validateAuthSession(getCookie(c, SESSION_COOKIE)));
  await next();
};

export const requireAuth: MiddlewareHandler<AuthEnv> = async (c, next) => {
  if (!c.get("auth")) throw new HttpError(401, "Unauthorized");
  await next();
};

export const auth = new Hono<AuthEnv>();

auth.get("/status", (c) =>
  c.json({ authenticated: !!c.get("auth"), setupRequired: passkeyCount() === 0 }),
);

// ── Registration ─────────────────────────────────────────────────────────

auth.post("/register/options", async (c) => {
  guardThrottle();
  const { rpID } = requireOrigin(c);
  const body = await c.req.json<{ enrollToken?: string }>().catch(() => ({}) as { enrollToken?: string });
  let enrollHash: string | null = null;
  if (!c.get("auth")) {
    enrollHash = checkEnrollToken(body.enrollToken);
    if (!enrollHash) {
      recordFailure();
      throw new HttpError(401, "Invalid or expired setup code");
    }
  }
  const user = userInfo().username;
  const options = await generateRegistrationOptions({
    rpName: config.auth.rpName,
    rpID,
    userID: userId(),
    userName: user,
    userDisplayName: user,
    attestationType: "none",
    excludeCredentials: listPasskeys().map((p) => ({ id: p.id, transports: p.transports ? JSON.parse(p.transports) : undefined })),
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
    // Face ID / Touch ID on this device rather than a security key.
    preferredAuthenticatorType: "localDevice",
  });
  rememberChallenge(options.challenge, { kind: "register", enrollHash });
  return c.json(options);
});

auth.post("/register/verify", async (c) => {
  guardThrottle();
  const { origin, rpID } = requireOrigin(c);
  const body = await c.req.json<{ response: RegistrationResponseJSON; name?: string }>();
  const challenge = challengeOf(body.response);
  const pending = challenge ? takeChallenge(challenge, "register") : null;
  if (!pending) throw new HttpError(400, "Registration expired — try again");
  // Re-check the authorisation the options were issued under: the invite may
  // have been used or the login revoked in the meantime.
  if (pending.enrollHash ? !enrollTokenLive(pending.enrollHash) : !c.get("auth")) {
    throw new HttpError(401, "Not authorised to register a passkey");
  }

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: body.response,
      expectedChallenge: challenge!,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    });
  } catch (e) {
    recordFailure();
    throw new HttpError(400, `Passkey registration failed: ${(e as Error).message}`);
  }
  if (!verification.verified) {
    recordFailure();
    throw new HttpError(400, "Passkey registration failed");
  }

  const info = verification.registrationInfo;
  const name = body.name?.trim().slice(0, 60) || deviceName(c.req.header("user-agent"));
  db.query(
    `INSERT INTO passkeys (id, public_key, counter, transports, device_type, backed_up, name, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    info.credential.id,
    info.credential.publicKey,
    info.credential.counter,
    info.credential.transports ? JSON.stringify(info.credential.transports) : null,
    info.credentialDeviceType,
    info.credentialBackedUp ? 1 : 0,
    name,
    now(),
  );
  if (pending.enrollHash) consumeEnrollToken(pending.enrollHash);
  console.info(`registered passkey "${name}" (${info.credential.id.slice(0, 12)}…)`);

  // A new device that enrolled with a token is signed in straight away.
  if (!c.get("auth")) setSessionCookie(c, createAuthSession(info.credential.id, c.req.header("user-agent")), origin);
  return c.json({ ok: true, name });
});

// ── Sign-in ──────────────────────────────────────────────────────────────

auth.post("/login/options", async (c) => {
  guardThrottle();
  const { rpID } = requireOrigin(c);
  // No allowCredentials: the passkey is discoverable, the OS offers it.
  const options = await generateAuthenticationOptions({ rpID, userVerification: "required" });
  rememberChallenge(options.challenge, { kind: "login" });
  return c.json(options);
});

auth.post("/login/verify", async (c) => {
  guardThrottle();
  const { origin, rpID } = requireOrigin(c);
  const body = await c.req.json<{ response: AuthenticationResponseJSON }>();
  const challenge = challengeOf(body.response);
  if (!challenge || !takeChallenge(challenge, "login")) throw new HttpError(400, "Sign-in expired — try again");

  const passkey = db.query<PasskeyRow, [string]>("SELECT * FROM passkeys WHERE id = ?").get(body.response.id);
  if (!passkey) {
    recordFailure();
    throw new HttpError(401, "This passkey is not registered here");
  }
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: body.response,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
      credential: {
        id: passkey.id,
        publicKey: new Uint8Array(passkey.public_key),
        counter: passkey.counter,
        transports: passkey.transports ? JSON.parse(passkey.transports) : undefined,
      },
    });
  } catch (e) {
    recordFailure();
    throw new HttpError(401, `Sign-in failed: ${(e as Error).message}`);
  }
  if (!verification.verified) {
    recordFailure();
    throw new HttpError(401, "Sign-in failed");
  }
  db.query("UPDATE passkeys SET counter = ?, last_used_at = ? WHERE id = ?").run(
    verification.authenticationInfo.newCounter,
    now(),
    passkey.id,
  );
  setSessionCookie(c, createAuthSession(passkey.id, c.req.header("user-agent")), origin);
  return c.json({ ok: true });
});

auth.post("/logout", (c) => {
  destroyAuthSession(getCookie(c, SESSION_COOKIE));
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

// ── Management (signed in) ───────────────────────────────────────────────

auth.get("/passkeys", requireAuth, (c) => {
  const current = c.get("auth")!.passkey_id;
  return c.json(
    listPasskeys().map((p) => ({
      id: p.id,
      name: p.name,
      createdAt: p.created_at,
      lastUsedAt: p.last_used_at,
      backedUp: !!p.backed_up,
      current: p.id === current,
    })),
  );
});

auth.patch("/passkeys/:id", requireAuth, async (c) => {
  const { name } = await c.req.json<{ name: string }>();
  if (!name?.trim()) throw new HttpError(422, "Name must not be empty");
  const res = db.query("UPDATE passkeys SET name = ? WHERE id = ?").run(name.trim().slice(0, 60), c.req.param("id"));
  if (!res.changes) throw new HttpError(404, "Passkey not found");
  return c.json({ ok: true });
});

auth.delete("/passkeys/:id", requireAuth, (c) => {
  // Deleting the last passkey would lock everyone out until a server-side reset.
  if (passkeyCount() <= 1) throw new HttpError(409, "Cannot remove the last passkey");
  // Its login sessions go with it (ON DELETE CASCADE).
  const res = db.query("DELETE FROM passkeys WHERE id = ?").run(c.req.param("id"));
  if (!res.changes) throw new HttpError(404, "Passkey not found");
  return c.json({ ok: true });
});

/** A short-lived code that lets a new device register its own passkey. */
auth.post("/invite", requireAuth, (c) => c.json(createEnrollToken(10 * 60_000)));

auth.post("/logout-others", requireAuth, (c) => c.json({ removed: destroyOtherSessions(c.get("auth")!.token_hash) }));
