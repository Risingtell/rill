/**
 * Fixtures below are trimmed copies of real Coston2 Blockscout responses for the
 * deployed shim, so the join logic is tested against the shape the explorer actually
 * returns rather than an invented one.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchChainImpact } from "../shared/chain-impact.js";
import { encodeTickNonce } from "../shared/tick-nonce.js";

const PAYEE = "0xCE79f6Ab3Ead906aB18e234bE511cbb209A21B62";
const SHIM = "0xb1a5826C3Ae8afDfB724D0DBaEEbAa4841605B86";
const FXRP = "0x0b6A3645c240605887a5532109323A3E12273dc7";
const AGENT = "0x9353e1CC8fB466fBb60740F81889a7A1f922FBdE";
const OTHER_TOKEN = "0x1111111111111111111111111111111111111111";

const TX_A = "0xaaa0000000000000000000000000000000000000000000000000000000000001";
const TX_B = "0xbbb0000000000000000000000000000000000000000000000000000000000002";
const TX_UNTRACKED = "0xccc0000000000000000000000000000000000000000000000000000000000003";
const TX_WRONG_TOKEN = "0xddd0000000000000000000000000000000000000000000000000000000000004";

function transfer(opts: {
  tx: string;
  value: string;
  token?: string;
  to?: string;
  from?: string;
  timestamp?: string;
}) {
  return {
    from: { hash: opts.from ?? AGENT },
    to: { hash: opts.to ?? PAYEE },
    token: { address_hash: opts.token ?? FXRP, symbol: "FTestXRP", name: "FXRP", decimals: "6" },
    total: { value: opts.value, decimals: "6" },
    transaction_hash: opts.tx,
    timestamp: opts.timestamp ?? "2026-08-13T10:00:00.000000Z",
    method: "transferWithAuthorization",
  };
}

function authLog(tx: string, nonce: string) {
  return {
    transaction_hash: tx,
    decoded: {
      method_call: "AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)",
      parameters: [
        { name: "authorizer", value: AGENT },
        { name: "nonce", value: nonce },
      ],
    },
  };
}

/** Swap in a fetch that serves the given payloads by URL substring. */
function stubFetch(transfers: unknown[], logs: unknown[], onCall?: (url: string) => void) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    onCall?.(url);
    const body = url.includes("/token-transfers")
      ? { items: transfers, next_page_params: null }
      : { items: logs, next_page_params: null };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

const opts = { chainId: 114 as const, payee: PAYEE as `0x${string}`, shimAddress: SHIM as `0x${string}`, fxrpAddress: FXRP as `0x${string}` };

test("joins transfers to authorization logs and decodes durations from the nonce", async () => {
  const restore = stubFetch(
    [transfer({ tx: TX_A, value: "100000" }), transfer({ tx: TX_B, value: "250000" })],
    [authLog(TX_A, encodeTickNonce(3000)), authLog(TX_B, encodeTickNonce(7500))]
  );
  try {
    const impact = await fetchChainImpact(opts);
    assert.equal(impact.totals.settlements, 2);
    assert.equal(impact.totals.totalPaid, "350000");
    assert.equal(impact.totals.totalPaidFormatted, "0.35");
    assert.equal(impact.totals.secondsStreamed, 10.5);
    assert.equal(impact.totals.durationsOnChain, 2);
    assert.equal(impact.totals.uniqueAgents, 1);
    assert.equal(impact.source, "chain");
    assert.equal(impact.mock, false);
  } finally {
    restore();
  }
});

test("ignores plain transfers the shim did not settle", async () => {
  // Anyone can send FXRP straight to the payee. Those are not metered settlements and
  // must not inflate the console's numbers.
  const restore = stubFetch(
    [transfer({ tx: TX_A, value: "100000" }), transfer({ tx: TX_UNTRACKED, value: "999999999" })],
    [authLog(TX_A, encodeTickNonce(3000))]
  );
  try {
    const impact = await fetchChainImpact(opts);
    assert.equal(impact.totals.settlements, 1);
    assert.equal(impact.totals.totalPaid, "100000");
  } finally {
    restore();
  }
});

test("ignores other ERC-20s sent to the same payee", async () => {
  const restore = stubFetch(
    [transfer({ tx: TX_WRONG_TOKEN, value: "500000", token: OTHER_TOKEN }), transfer({ tx: TX_A, value: "100000" })],
    [authLog(TX_WRONG_TOKEN, encodeTickNonce(1000)), authLog(TX_A, encodeTickNonce(3000))]
  );
  try {
    const impact = await fetchChainImpact(opts);
    assert.equal(impact.totals.settlements, 1);
    assert.equal(impact.recent[0].txHash, TX_A);
  } finally {
    restore();
  }
});

test("ignores transfers addressed to somebody else", async () => {
  const restore = stubFetch(
    [transfer({ tx: TX_A, value: "100000", to: "0x9999999999999999999999999999999999999999" })],
    [authLog(TX_A, encodeTickNonce(3000))]
  );
  try {
    assert.equal((await fetchChainImpact(opts)).totals.settlements, 0);
  } finally {
    restore();
  }
});

test("still counts a settlement whose nonce carries no duration", async () => {
  // The original proof tx used a plain random nonce. It is a real settlement and must
  // count toward totals, with seconds reported as unknown rather than zero.
  const restore = stubFetch([transfer({ tx: TX_A, value: "100000" })], [authLog(TX_A, `0x${"ab".repeat(32)}`)]);
  try {
    const impact = await fetchChainImpact(opts);
    assert.equal(impact.totals.settlements, 1);
    assert.equal(impact.totals.durationsOnChain, 0);
    assert.equal(impact.totals.secondsStreamed, 0);
    assert.equal(impact.recent[0].seconds, undefined);
  } finally {
    restore();
  }
});

test("counts distinct agents", async () => {
  const other = "0x4444444444444444444444444444444444444444";
  const restore = stubFetch(
    [transfer({ tx: TX_A, value: "1" }), transfer({ tx: TX_B, value: "1", from: other })],
    [authLog(TX_A, encodeTickNonce(1000)), authLog(TX_B, encodeTickNonce(1000))]
  );
  try {
    assert.equal((await fetchChainImpact(opts)).totals.uniqueAgents, 2);
  } finally {
    restore();
  }
});

test("returns most recent settlement first", async () => {
  const restore = stubFetch(
    [
      transfer({ tx: TX_A, value: "1", timestamp: "2026-08-01T10:00:00.000000Z" }),
      transfer({ tx: TX_B, value: "1", timestamp: "2026-08-13T10:00:00.000000Z" }),
    ],
    [authLog(TX_A, encodeTickNonce(1000)), authLog(TX_B, encodeTickNonce(1000))]
  );
  try {
    assert.equal((await fetchChainImpact(opts)).recent[0].txHash, TX_B);
  } finally {
    restore();
  }
});

test("surfaces an explorer outage instead of reporting zero settlements", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response("upstream down", { status: 503 })) as typeof fetch;
  try {
    await assert.rejects(() => fetchChainImpact(opts), /explorer 503/);
  } finally {
    globalThis.fetch = original;
  }
});

test("queries the payee, the shim and the right explorer host", async () => {
  const urls: string[] = [];
  const restore = stubFetch([], [], (u) => urls.push(u));
  try {
    await fetchChainImpact(opts);
    assert.ok(urls.some((u) => u.includes(PAYEE) && u.includes("/token-transfers")));
    assert.ok(urls.some((u) => u.includes(SHIM) && u.includes("/logs")));
    assert.ok(urls.every((u) => u.startsWith("https://coston2-explorer.flare.network")));
  } finally {
    restore();
  }
});
