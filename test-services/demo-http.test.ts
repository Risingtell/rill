/**
 * Integration tests over the demo server's actual HTTP surface.
 *
 * The unit tests cover each shared module in isolation, but the thing that actually
 * broke in production was the wiring: sessions lived in process memory, so the second
 * request in a run could not find the session the first one opened. Nothing at the
 * module level would have caught that. These drive the real Express app end to end in
 * mock settlement mode, which is the same code path as live minus the chain.
 *
 * The server is imported, not spawned, so it runs in-process on an ephemeral port.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";

// Force mock mode. These are set to empty rather than deleted on purpose: the app
// imports dotenv/config, which repopulates anything MISSING from a local .env file but
// leaves keys that already exist alone. Deleting them would silently hand the test a
// real facilitator key and run it against the live chain.
process.env.RILL_SESSION_SECRET = "integration-test-secret";
process.env.RILL_FACILITATOR_KEY = "";
process.env.RILL_SHIM_ADDRESS = "";
process.env.RILL_PAYEE_ADDRESS = "";

const { default: app } = await import("../apps/demo/app.js");

let server: Server;
let base: string;

before(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      base = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

after(() => {
  server?.close();
});

const AGENT = "0x1111111111111111111111111111111111111111";

async function openSession(agent = AGENT): Promise<string> {
  const res = await fetch(`${base}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent, objective: "integration test" }),
  });
  assert.equal(res.status, 201);
  const body = (await res.json()) as { id: string };
  return body.id;
}

interface Accept {
  amount: string;
  payTo: string;
  asset: string;
  extra: { name?: string; version?: string; nonce: string; validAfter: string; validBefore: string; quoteToken?: string };
}

/** Ask for a quote, retrying once through the 425 guard the way a real client does. */
async function quote(sessionToken: string): Promise<Accept> {
  let res = await fetch(`${base}/sessions/${sessionToken}/tick`, { method: "POST" });
  if (res.status === 425) {
    const body = (await res.json()) as { retryAfterMs?: number };
    await new Promise((r) => setTimeout(r, Math.min(body.retryAfterMs ?? 1000, 2000)));
    res = await fetch(`${base}/sessions/${sessionToken}/tick`, { method: "POST" });
  }
  assert.equal(res.status, 402, "expected a 402 payment required");
  const body = (await res.json()) as { accepts: Accept[] };
  return body.accepts[0];
}

async function settle(sessionToken: string, accept: Accept) {
  return fetch(`${base}/sessions/${sessionToken}/tick`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteToken: accept.extra.quoteToken,
      authorization: {
        from: AGENT,
        to: accept.payTo,
        value: accept.amount,
        validAfter: accept.extra.validAfter,
        validBefore: accept.extra.validBefore,
        nonce: accept.extra.nonce,
        signature: "0x00",
      },
    }),
  });
}

test("serves the console at the root", async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /Rill: live console/);
});

test("reports mock mode in /config", async () => {
  const res = await fetch(`${base}/config`);
  assert.equal(res.status, 200);
  const cfg = (await res.json()) as { mock: boolean; chainId: number };
  assert.equal(cfg.mock, true);
  assert.equal(cfg.chainId, 114);
});

test("rejects a session with no agent", async () => {
  const res = await fetch(`${base}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 400);
});

test("runs a full open, quote, settle, close cycle", async () => {
  const token = await openSession();
  const accept = await quote(token);

  assert.ok(BigInt(accept.amount) > 0n, "a quoted tick must bill something");
  assert.equal(accept.extra.name, "FXRP3009", "402 must advertise the EIP-712 domain");
  assert.equal(accept.extra.version, "1");
  assert.ok(accept.extra.quoteToken, "402 must carry a signed quote token");

  const res = await settle(token, accept);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { session: { id: string; ticks: number }; settlement: { txHash: string } };
  assert.equal(body.session.ticks, 1);
  assert.ok(body.settlement.txHash);

  const closed = await fetch(`${base}/sessions/${body.session.id}/close`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason: "done" }),
  });
  assert.equal(closed.status, 200);
});

test("advances session state across ticks using the rotated token", async () => {
  // This is the regression that mattered: each tick must build on the previous one,
  // with no server-side memory of the session between requests.
  let token = await openSession();
  for (let i = 1; i <= 3; i++) {
    const accept = await quote(token);
    const res = await settle(token, accept);
    assert.equal(res.status, 200, `tick ${i} should settle`);
    const body = (await res.json()) as { session: { id: string; ticks: number } };
    assert.equal(body.session.ticks, i, "tick count must advance");
    token = body.session.id;
  }
});

test("never quotes a tick that would bill zero", async () => {
  // Written as an invariant rather than "expect a 425", because at the demo rate a
  // single smallest-unit accrues in about 10ms, so whether an immediate tick is
  // billable depends on scheduling. The property that must always hold is that a 402
  // never asks an agent to sign away nothing.
  const token = await openSession();
  const res = await fetch(`${base}/sessions/${token}/tick`, { method: "POST" });

  if (res.status === 425) {
    const body = (await res.json()) as { retryAfterMs: number };
    assert.ok(body.retryAfterMs >= 1000, "should advise waiting for a meaningful tick");
    return;
  }

  assert.equal(res.status, 402);
  const body = (await res.json()) as { accepts: Accept[] };
  assert.ok(BigInt(body.accepts[0].amount) > 0n, "a 402 must never quote a zero amount");
});

test("returns 425 with a retry hint when the rate is too slow to have accrued anything", async () => {
  // A second app instance priced so slowly that a unit takes ~10s to accrue, which
  // makes the guard fire deterministically instead of depending on timing. The query
  // string defeats the ESM module cache so the module re-reads its env.
  const previousRate = process.env.RILL_USD_PER_SECOND;
  process.env.RILL_USD_PER_SECOND = "0.0000001";
  // Held in a variable so TypeScript treats it as a dynamic specifier: the query
  // string is a runtime cache-buster, not a module it can resolve on disk.
  const slowSpecifier = "../apps/demo/app.js?slow-rate";
  const { default: slowApp } = (await import(slowSpecifier)) as { default: typeof app };
  if (previousRate === undefined) delete process.env.RILL_USD_PER_SECOND;
  else process.env.RILL_USD_PER_SECOND = previousRate;

  const slowServer = slowApp.listen(0);
  try {
    await new Promise<void>((resolve) => slowServer.once("listening", () => resolve()));
    const addr = slowServer.address();
    const slowBase = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;

    const open = await fetch(`${slowBase}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent: AGENT }),
    });
    const { id } = (await open.json()) as { id: string };

    const res = await fetch(`${slowBase}/sessions/${id}/tick`, { method: "POST" });
    assert.equal(res.status, 425, "a tick worth less than one smallest-unit must be refused");
    const body = (await res.json()) as { retryAfterMs: number; error: string };
    assert.match(body.error, /bill zero/);
    assert.ok(body.retryAfterMs >= 1000);
  } finally {
    slowServer.close();
  }
});

test("rejects an unknown session token", async () => {
  const res = await fetch(`${base}/sessions/not-a-real-token/tick`, { method: "POST" });
  assert.equal(res.status, 404);
});

test("rejects a session token signed with the wrong key", async () => {
  const forged = "r1.eyJpZCI6ImZha2UifQ.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  const res = await fetch(`${base}/sessions/${forged}/tick`, { method: "POST" });
  assert.equal(res.status, 404);
});

test("refuses to settle without a quote token", async () => {
  const token = await openSession();
  const res = await fetch(`${base}/sessions/${token}/tick`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ authorization: { from: AGENT, to: AGENT, value: "1", validAfter: "0", validBefore: "9999999999", nonce: "0x00", signature: "0x00" } }),
  });
  assert.equal(res.status, 409);
});

test("refuses to settle against a tampered quote token", async () => {
  const token = await openSession();
  const accept = await quote(token);
  const tampered = { ...accept, extra: { ...accept.extra, quoteToken: accept.extra.quoteToken!.slice(0, -4) + "AAAA" } };
  const res = await settle(token, tampered);
  assert.equal(res.status, 409);
});

test("keeps two concurrent sessions independent", async () => {
  // Two agents on one server must not share or clobber each other's state.
  const a = await openSession("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  const b = await openSession("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");

  const [qa, qb] = await Promise.all([quote(a), quote(b)]);
  const [ra, rb] = await Promise.all([settle(a, qa), settle(b, qb)]);
  assert.equal(ra.status, 200);
  assert.equal(rb.status, 200);

  const bodyA = (await ra.json()) as { session: { agent: string; ticks: number } };
  const bodyB = (await rb.json()) as { session: { agent: string; ticks: number } };
  assert.equal(bodyA.session.ticks, 1);
  assert.equal(bodyB.session.ticks, 1);
  assert.notEqual(bodyA.session.agent, bodyB.session.agent);
});

test("prices the stream from the live FTSO feed", async () => {
  const res = await fetch(`${base}/streams`);
  assert.equal(res.status, 200);
  const streams = (await res.json()) as { id: string; ratePerSecond: string; asset: string }[];
  assert.equal(streams.length, 1);
  assert.equal(streams[0].asset, "FXRP");
  assert.ok(BigInt(streams[0].ratePerSecond) > 0n, "rate must come out positive");
});

test("serves impact from memory in mock mode, flagged as such", async () => {
  const res = await fetch(`${base}/impact`);
  assert.equal(res.status, 200);
  const impact = (await res.json()) as { source: string; mock: boolean };
  assert.equal(impact.source, "memory");
  assert.equal(impact.mock, true);
});
