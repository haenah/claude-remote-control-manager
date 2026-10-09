import { expect, test } from "bun:test";
import {
  checkEnrollToken,
  consumeEnrollToken,
  createAuthSession,
  createEnrollToken,
  destroyAuthSession,
  rememberChallenge,
  takeChallenge,
  validateAuthSession,
} from "../src/auth/store";
import { db, now } from "../src/db";

test("enroll tokens are case- and separator-insensitive and single use", () => {
  const { token } = createEnrollToken(60_000);
  expect(token).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
  const hash = checkEnrollToken(token.toLowerCase().replaceAll("-", " "));
  expect(hash).not.toBeNull();
  consumeEnrollToken(hash!);
  expect(checkEnrollToken(token)).toBeNull();
});

test("expired enroll tokens are rejected", () => {
  const { token } = createEnrollToken(-1);
  expect(checkEnrollToken(token)).toBeNull();
});

test("challenges are single use and kind-checked", () => {
  rememberChallenge("c1", { kind: "login" });
  expect(takeChallenge("c1", "register")).toBeNull();
  // Taken (and discarded) by the failed attempt above.
  expect(takeChallenge("c1", "login")).toBeNull();
  rememberChallenge("c2", { kind: "login" });
  expect(takeChallenge("c2", "login")).not.toBeNull();
});

test("login sessions validate until destroyed", () => {
  db.query(
    "INSERT INTO passkeys (id, public_key, name, created_at) VALUES ('pk1', x'00', 'test', ?)",
  ).run(now());
  const token = createAuthSession("pk1", "test");
  expect(validateAuthSession(token)?.passkey_id).toBe("pk1");
  expect(validateAuthSession("forged")).toBeNull();
  destroyAuthSession(token);
  expect(validateAuthSession(token)).toBeNull();
});
