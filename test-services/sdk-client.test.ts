/**
 * Tests for the published client surface. These drive Fxrp3009Client against a stubbed
 * server so the x402 negotiation is covered without spending real FXRP: the parts that
 * must not regress are what it signs and what it sends, not that the chain accepts it
 * (the live agent runs cover that).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import { recoverTypedDataAddress, type Hex } from "viem";
import { Fxrp3009Client, randomNonce } from "../packages/sdk/src/client.js";
import { FXRP3009_ADDRESS, TRANSFER_AUTH_TYPES } from "../packages/sdk/src/constants.js";
import { encodeTickNonce } from "../shared/tick-nonce.js";

const KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex;
const account = privateKeyToAccount(KEY);
const PAYEE = "0xD7Ed634428b091eb8ead65c363D0648AC3D27051" as Hex;

function client(facilitatorUrl?: string) {
  return new Fxrp3009Client({ account, chainId: 114, facilitatorUrl });
}

const requirement = (extra: Record<string, unknown> = {}) => ({
  scheme: "exact",
  network: "eip155:114",
  asset: FXRP3009_ADDRESS[114],
  amount: "1097",
  payTo: PAYEE,
  maxTimeoutSeconds: 120,
  extra: { name: "FXRP3009", version: "1", ...extra },
});

/** Swap fetch for a scripted 402-then-200 exchange, capturing what the client sent. */
function stub(first: unknown, status = 402) {
  const calls: { url: string; init: RequestInit }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) {
      return new Response(JSON.stringify(first), { status, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

test("defaults to the published shim for the network", () => {
  assert.equal(client().shimAddress, FXRP3009_ADDRESS[114]);
});

test("signs an authorization that recovers back to the payer", async () => {
  const auth = await client().signAuthorization(requirement({ nonce: encodeTickNonce(7307) }));
  const recovered = await recoverTypedDataAddress({
    domain: { name: "FXRP3009", version: "1", chainId: 114, verifyingContract: FXRP3009_ADDRESS[114] },
    types: TRANSFER_AUTH_TYPES,
    primaryType: "TransferWithAuthorization",
    message: {
      from: auth.from,
      to: auth.to,
      value: BigInt(auth.value),
      validAfter: BigInt(auth.validAfter),
      validBefore: BigInt(auth.validBefore),
      nonce: auth.nonce,
    },
    signature: auth.signature,
  });
  assert.equal(recovered.toLowerCase(), account.address.toLowerCase());
});

test("signs the server's exact amount, payee and nonce", async () => {
  const nonce = encodeTickNonce(4200);
  const auth = await client().signAuthorization(requirement({ nonce }));
  assert.equal(auth.value, "1097");
  assert.equal(auth.to, PAYEE);
  assert.equal(auth.nonce, nonce, "must use the server's nonce, not one of its own");
});

test("refuses to sign without the asset's EIP-712 domain", async () => {
  // Without name/version the digest cannot be rebuilt, so a signature would be
  // unverifiable. Better to fail loudly than produce one that always gets rejected.
  const req = requirement();
  delete (req.extra as Record<string, unknown>).name;
  await assert.rejects(() => client().signAuthorization(req as never), /EIP-712 domain/);
});

test("mints its own nonce when the server does not supply one", async () => {
  const auth = await client().signAuthorization(requirement());
  assert.equal(auth.nonce.length, 66);
  assert.notEqual(auth.nonce, `0x${"00".repeat(32)}`);
});

test("passes a non-402 response straight through without paying", async () => {
  const { calls, restore } = stub({ ok: true }, 200);
  try {
    const res = await client().fetchPaid("https://x.example/thing");
    assert.equal(res.status, 200);
    assert.equal(calls.length, 1, "must not retry a response that was not a 402");
  } finally {
    restore();
  }
});

test("pays a 402 and retries with both the header and the body", async () => {
  const { calls, restore } = stub({ x402Version: 2, accepts: [requirement({ nonce: encodeTickNonce(3000), quoteToken: "tok-123" })] });
  try {
    const res = await client().fetchPaid("https://x.example/thing", { method: "POST" });
    assert.equal(res.status, 200);
    assert.equal(calls.length, 2);

    const retry = calls[1].init;
    const headers = retry.headers as Record<string, string>;
    assert.ok(headers["X-PAYMENT"], "standard x402 servers read the X-PAYMENT header");

    const decoded = JSON.parse(Buffer.from(headers["X-PAYMENT"], "base64").toString("utf8"));
    assert.equal(decoded.payload.authorization.value, "1097");
    assert.equal(decoded.x402Version, 2);

    const body = JSON.parse(String(retry.body));
    assert.equal(body.authorization.value, "1097");
    assert.equal(body.quoteToken, "tok-123", "a server-issued quote token must be echoed back untouched");
  } finally {
    restore();
  }
});

test("keeps a paid GET a GET, with no body", async () => {
  const { calls, restore } = stub({ accepts: [requirement()] });
  try {
    await client().fetchPaid("https://x.example/thing");
    const retry = calls[1].init;
    assert.equal((retry.method ?? "GET").toUpperCase(), "GET");
    assert.equal(retry.body, undefined, "a GET must not carry a body");
    assert.ok((retry.headers as Record<string, string>)["X-PAYMENT"], "so payment has to ride the header");
  } finally {
    restore();
  }
});

test("throws when a 402 carries no payment requirements", async () => {
  const { restore } = stub({ accepts: [] });
  try {
    await assert.rejects(() => client().fetchPaid("https://x.example/thing"), /no payment requirements/);
  } finally {
    restore();
  }
});

test("openSession needs a facilitator, and says so", async () => {
  await assert.rejects(() => client().openSession({ budget: 1n }), /facilitatorUrl/);
});

test("randomNonce produces distinct 32-byte values", () => {
  const seen = new Set(Array.from({ length: 500 }, () => randomNonce()));
  assert.equal(seen.size, 500);
  assert.equal([...seen][0].length, 66);
});
