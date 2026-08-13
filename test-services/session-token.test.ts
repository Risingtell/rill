import { test } from "node:test";
import assert from "node:assert/strict";
import { signToken, verifyToken, resolveSessionSecret } from "../shared/session-token.js";

const secret = Buffer.from("test-secret-value");

test("round-trips a session payload", () => {
  const session = { id: "abc", agent: "0x1", ticks: 3, totalPaid: "500", settledMs: 4200 };
  const decoded = verifyToken<typeof session>(secret, signToken(secret, session));
  assert.deepEqual(decoded, session);
});

test("rejects a token signed with a different key", () => {
  const token = signToken(Buffer.from("other-secret"), { id: "abc" });
  assert.equal(verifyToken(secret, token), undefined);
});

test("rejects a tampered payload", () => {
  // The whole point: a client must not be able to edit its own session state.
  const token = signToken(secret, { id: "abc", totalPaid: "1" });
  const [version, , mac] = token.split(".");
  const forged = Buffer.from(JSON.stringify({ id: "abc", totalPaid: "999999" }), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  assert.equal(verifyToken(secret, `${version}.${forged}.${mac}`), undefined);
});

test("rejects malformed tokens rather than throwing", () => {
  for (const bad of ["", "nonsense", "a.b", "a.b.c.d", "r1.!!!.###"]) {
    assert.equal(verifyToken(secret, bad), undefined, `should reject ${JSON.stringify(bad)}`);
  }
  assert.equal(verifyToken(secret, undefined), undefined);
});

test("rejects a token from a different format version", () => {
  const token = signToken(secret, { id: "abc" });
  assert.equal(verifyToken(secret, token.replace(/^r1\./, "r2.")), undefined);
});

test("an explicit secret wins over the derived one", () => {
  const { secret: s, ephemeral } = resolveSessionSecret({ RILL_SESSION_SECRET: "explicit", RILL_FACILITATOR_KEY: "0xabc" } as NodeJS.ProcessEnv);
  assert.equal(ephemeral, false);
  assert.equal(s.toString("utf8"), "explicit");
});

test("derives a stable secret from the facilitator key so every instance agrees", () => {
  // Instances share the facilitator key, so tokens minted by one verify on another.
  const env = { RILL_FACILITATOR_KEY: "0xdeadbeef" } as NodeJS.ProcessEnv;
  const a = resolveSessionSecret(env);
  const b = resolveSessionSecret(env);
  assert.equal(a.secret.toString("hex"), b.secret.toString("hex"));
  assert.equal(a.ephemeral, false);
  // and it must not simply be the signing key itself
  assert.notEqual(a.secret.toString("utf8"), "0xdeadbeef");
});

test("different facilitator keys derive different secrets", () => {
  const a = resolveSessionSecret({ RILL_FACILITATOR_KEY: "0xaaa" } as NodeJS.ProcessEnv).secret.toString("hex");
  const b = resolveSessionSecret({ RILL_FACILITATOR_KEY: "0xbbb" } as NodeJS.ProcessEnv).secret.toString("hex");
  assert.notEqual(a, b);
});

test("falls back to an ephemeral secret when nothing is configured", () => {
  const { ephemeral } = resolveSessionSecret({} as NodeJS.ProcessEnv);
  assert.equal(ephemeral, true);
});

test("a token minted by one instance verifies on another with the same facilitator key", () => {
  const env = { RILL_FACILITATOR_KEY: "0xkey" } as NodeJS.ProcessEnv;
  const instanceA = resolveSessionSecret(env).secret;
  const instanceB = resolveSessionSecret(env).secret;
  const token = signToken(instanceA, { id: "session-1", ticks: 2 });
  assert.deepEqual(verifyToken(instanceB, token), { id: "session-1", ticks: 2 });
});
