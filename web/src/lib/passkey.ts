import { startAuthentication, startRegistration, WebAuthnError } from "@simplewebauthn/browser";
import { api } from "./api";

/** A friendlier message for the ways the OS passkey sheet can fail. */
function explain(e: unknown): Error {
  if (e instanceof WebAuthnError) {
    if (e.code === "ERROR_CEREMONY_ABORTED") return new Error("Cancelled");
    if (e.code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED") return new Error("This device already has a passkey here");
  }
  if (e instanceof Error && e.name === "NotAllowedError") return new Error("Cancelled or timed out");
  return e instanceof Error ? e : new Error(String(e));
}

export async function signInWithPasskey(): Promise<void> {
  const optionsJSON = await api<Parameters<typeof startAuthentication>[0]["optionsJSON"]>("/auth/login/options", {
    body: {},
  });
  let response;
  try {
    response = await startAuthentication({ optionsJSON });
  } catch (e) {
    throw explain(e);
  }
  await api("/auth/login/verify", { body: { response } });
}

/** Register this device's passkey — with an enroll token, or while signed in. */
export async function registerPasskey(opts: { enrollToken?: string; name?: string }): Promise<void> {
  const optionsJSON = await api<Parameters<typeof startRegistration>[0]["optionsJSON"]>("/auth/register/options", {
    body: { enrollToken: opts.enrollToken },
  });
  let response;
  try {
    response = await startRegistration({ optionsJSON });
  } catch (e) {
    throw explain(e);
  }
  await api("/auth/register/verify", { body: { response, name: opts.name } });
}
