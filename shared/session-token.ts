/**
 * Signed, self-contained tokens for session and quote state.
 *
 * The demo originally held open sessions and pending quotes in two in-process Maps.
 * On the serverless host this is deployed to, consecutive requests from one agent can
 * land on different instances, so a session opened by one request is simply absent
 * from the next: the tick returns 404 and no agent can ever complete a run. That is
 * not a hypothetical, it is what the deployed build did before this module existed.
 *
 * Rather than bolt on a database for state that only ever lives for one short run,
 * the state travels with the client, authenticated by an HMAC so it cannot be edited.
 * The server keeps nothing between requests.
 *
 * Replay is bounded by design rather than by bookkeeping:
 *   - A stale SESSION token carries an older `lastSettledAt`, so replaying it bills
 *     MORE elapsed time, never less. There is nothing to gain by rewinding, and a
 *     client cannot forge a newer timestamp without the key.
 *   - A stale QUOTE token can only be settled once, because settling it consumes the
 *     EIP-3009 nonce bound to it, and the shim rejects a nonce it has already seen.
 *     The chain enforces single use, so the server does not have to remember.
 *
 * Tokens are not secret: they describe the holder's own session. The HMAC is there to
 * stop tampering, not to hide anything.
 */

import { createHmac, createHash, randomBytes, timingSafeEqual } from "node:crypto";

const VERSION = "r1";

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

/**
 * Resolve the signing key.
 *
 * An explicit RILL_SESSION_SECRET wins. Failing that, derive one from the facilitator
 * key: every instance of a given deployment holds the same facilitator key, so the
 * derived secret is automatically identical across instances without adding a second
 * thing to configure. The derivation is one-way and domain-separated, so the token key
 * cannot be walked back to the signing key.
 *
 * With neither available (local mock mode) fall back to a per-process random secret.
 * Tokens then stop working across restarts, which is harmless for a single local run.
 */
export function resolveSessionSecret(env: NodeJS.ProcessEnv = process.env): { secret: Buffer; ephemeral: boolean } {
  if (env.RILL_SESSION_SECRET) {
    return { secret: Buffer.from(env.RILL_SESSION_SECRET, "utf8"), ephemeral: false };
  }
  if (env.RILL_FACILITATOR_KEY) {
    const derived = createHash("sha256")
      .update("rill/session-token/v1\u0000")
      .update(env.RILL_FACILITATOR_KEY.trim())
      .digest();
    return { secret: derived, ephemeral: false };
  }
  return { secret: randomBytes(32), ephemeral: true };
}

/** Sign a payload into a URL-safe, tamper-evident token. */
export function signToken(secret: Buffer, payload: unknown): string {
  const body = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
  const mac = b64url(createHmac("sha256", secret).update(`${VERSION}.${body}`).digest());
  return `${VERSION}.${body}.${mac}`;
}

/**
 * Verify and decode a token. Returns undefined for anything that was not signed by
 * this key, rather than throwing, so callers can answer with a clean 404.
 */
export function verifyToken<T>(secret: Buffer, token: string | undefined): T | undefined {
  if (!token) return undefined;
  const parts = token.split(".");
  if (parts.length !== 3) return undefined;
  const [version, body, mac] = parts;
  if (version !== VERSION) return undefined;

  const expected = createHmac("sha256", secret).update(`${version}.${body}`).digest();
  const actual = fromB64url(mac);
  if (actual.length !== expected.length) return undefined;
  if (!timingSafeEqual(actual, expected)) return undefined;

  try {
    return JSON.parse(fromB64url(body).toString("utf8")) as T;
  } catch {
    return undefined;
  }
}
