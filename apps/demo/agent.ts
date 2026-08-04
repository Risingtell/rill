/**
 * Demo agent: an FXRP holder with zero gas, streaming the live XRP/USD feed and
 * paying for it. Every signature here is free — the only on-chain cost this process
 * ever causes is paid by the facilitator, which is exactly the property FXRP3009
 * exists to prove (SPEC.md: "Zero C2FLR ever needed").
 *
 * Flow: one EIP-2612 permit at session open (facilitator-sponsored via
 * /sponsor-permit), then a signed EIP-3009 authorization per tick, matched exactly to
 * the server's quoted amount from its 402 response — see server.ts's two-phase tick
 * design for why the amount must come from the server, not be computed locally.
 */

import "dotenv/config";
import { createPublicClient, http as viemHttp, type Hex } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { coston2, flare, FXRP_ADDRESS } from "../../shared/flare-chains.js";

const CHAIN_ID = (parseInt(process.env.RILL_CHAIN_ID || "114", 10) === 14 ? 14 : 114) as 114 | 14;
const DEMO_URL = process.env.RILL_DEMO_URL || "http://localhost:8403";
const FACILITATOR_URL = process.env.RILL_FACILITATOR_URL || "http://localhost:8402";
const SHIM_ADDRESS = process.env.RILL_SHIM_ADDRESS as Hex | undefined;
const TICKS = parseInt(process.env.RILL_AGENT_TICKS || "5", 10);
const TICK_INTERVAL_MS = parseInt(process.env.RILL_AGENT_TICK_MS || "3000", 10);
const SESSION_BUDGET = process.env.RILL_SESSION_BUDGET || "1000000"; // 1.0 FXRP at 6dp

const chain = CHAIN_ID === 114 ? coston2 : flare;
const publicClient = createPublicClient({ chain, transport: viemHttp(process.env.RILL_RPC_URL) });

const PERMIT_TYPES = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

const TRANSFER_AUTH_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

const NONCES_ABI = [
  { type: "function", name: "nonces", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
] as const;

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

async function openPermit(account: ReturnType<typeof privateKeyToAccount>) {
  if (!SHIM_ADDRESS) throw new Error("RILL_SHIM_ADDRESS must be set to open a live session.");
  const fxrpAddress = FXRP_ADDRESS[CHAIN_ID];
  const nonce = await publicClient.readContract({ address: fxrpAddress, abi: NONCES_ABI, functionName: "nonces", args: [account.address] });
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

  const signature = await account.signTypedData({
    domain: { name: "FXRP", version: "1", chainId: chain.id, verifyingContract: fxrpAddress },
    types: PERMIT_TYPES,
    primaryType: "Permit",
    message: { owner: account.address, spender: SHIM_ADDRESS, value: BigInt(SESSION_BUDGET), nonce, deadline },
  });
  const { r, s, v } = splitSignature(signature);

  const res = await fetch(`${FACILITATOR_URL}/sponsor-permit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ owner: account.address, value: SESSION_BUDGET, deadline: deadline.toString(), v, r, s }),
  });
  const body = await json<{ success: boolean; transaction?: string; errorMessage?: string }>(res);
  if (!body.success) throw new Error(`permit sponsorship failed: ${body.errorMessage ?? "unknown"}`);
  console.log(`[agent] session permit landed: ${body.transaction}`);
}

function splitSignature(sig: Hex): { r: Hex; s: Hex; v: number } {
  const r = `0x${sig.slice(2, 66)}` as Hex;
  const s = `0x${sig.slice(66, 130)}` as Hex;
  const v = parseInt(sig.slice(130, 132), 16);
  return { r, s, v };
}

async function tick(account: ReturnType<typeof privateKeyToAccount>, sessionId: string) {
  const quoteRes = await fetch(`${DEMO_URL}/sessions/${sessionId}/tick`, { method: "POST" });
  if (quoteRes.status !== 402) throw new Error(`expected 402 quote, got ${quoteRes.status}`);
  interface Accept {
    amount: string;
    payTo: Hex;
    asset: Hex;
    extra: { nonce: Hex; validAfter: string; validBefore: string };
  }
  const { accepts } = await json<{ accepts: Accept[] }>(quoteRes);
  const req = accepts[0];

  const signature = await account.signTypedData({
    domain: { name: "FXRP3009", version: "1", chainId: chain.id, verifyingContract: (SHIM_ADDRESS ?? req.asset) as Hex },
    types: TRANSFER_AUTH_TYPES,
    primaryType: "TransferWithAuthorization",
    message: {
      from: account.address,
      to: req.payTo,
      value: BigInt(req.amount),
      validAfter: BigInt(req.extra.validAfter),
      validBefore: BigInt(req.extra.validBefore),
      nonce: req.extra.nonce,
    },
  });

  const settleRes = await fetch(`${DEMO_URL}/sessions/${sessionId}/tick`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      authorization: {
        from: account.address,
        to: req.payTo,
        value: req.amount,
        validAfter: req.extra.validAfter,
        validBefore: req.extra.validBefore,
        nonce: req.extra.nonce,
        signature,
      },
    }),
  });
  const settled = await json<{
    error?: string;
    session: { ticks: number };
    settlement: { txHash: string };
    data?: { xrpUsd: number };
  }>(settleRes);
  if (!settleRes.ok) throw new Error(`tick failed: ${settled.error ?? "unknown"}`);
  console.log(
    `[agent] tick ${settled.session.ticks}: paid ${req.amount} FXRP-units, tx ${settled.settlement.txHash || "(mock)"}, xrpUsd=${settled.data?.xrpUsd ?? "?"}`
  );
}

async function main() {
  const key = process.env.RILL_AGENT_KEY;
  const account = privateKeyToAccount((key ? (key.startsWith("0x") ? key : `0x${key}`) : generatePrivateKey()) as Hex);
  console.log(`[agent] address: ${account.address}`);

  if (SHIM_ADDRESS) await openPermit(account);

  const openRes = await fetch(`${DEMO_URL}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent: account.address, objective: "stream the live XRP/USD feed" }),
  });
  const session = await json<{ id: string }>(openRes);
  console.log(`[agent] session opened: ${session.id}`);

  for (let i = 0; i < TICKS; i++) {
    await tick(account, session.id);
    await new Promise((r) => setTimeout(r, TICK_INTERVAL_MS));
  }

  await fetch(`${DEMO_URL}/sessions/${session.id}/close`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason: "demo run complete" }),
  });
  console.log(`[agent] session closed after ${TICKS} ticks`);
}

main().catch((err) => {
  console.error("[agent] fatal:", err.message);
  process.exit(1);
});
