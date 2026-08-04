/**
 * Rill demo resource server: pay-per-second access to a live FTSOv2 XRP/USD feed,
 * settled in real FXRP through the FXRP3009 shim.
 *
 * Ticks are two-phase, not one-shot, because meter402's quoteTick() is a pure
 * computation of elapsed wall-clock time — if the server re-quoted after the client
 * signs, the signed amount and the settled amount could drift apart on every request.
 * So the server quotes once, stashes that exact quote, and returns it as a standard
 * x402 402 Payment Required response; the client signs an EIP-3009 authorization for
 * that exact amount and resubmits; the server settles the STASHED quote, never a fresh
 * one, so the signed amount and the settled amount are always identical.
 */

import "dotenv/config";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import express, { type Request, type Response } from "express";
import cors from "cors";
import { createPublicClient, http as viemHttp, type Hex } from "viem";
import { StreamingMeter, MemoryStore, MockSettlementProvider, MeterError, type TickQuote } from "meter402";
import { Fxrp3009SettlementProvider, facilitatorKeyConfigured, type PendingAuthorization } from "../../packages/provider/index.js";
import { coston2, flare, FXRP_ADDRESS } from "../../shared/flare-chains.js";
import { getXrpUsdPrice, usdPerSecondToFxrpPerSecond, type XrpUsdPrice } from "../../shared/ftso.js";

const CHAIN_ID = (parseInt(process.env.RILL_CHAIN_ID || "114", 10) === 14 ? 14 : 114) as 114 | 14;
const SHIM_ADDRESS = process.env.RILL_SHIM_ADDRESS as Hex | undefined;
const PAY_TO = process.env.RILL_PAYEE_ADDRESS as Hex | undefined;
const DEFAULT_PAY_TO: Hex = PAY_TO ?? "0x000000000000000000000000000000000000dEaD";
const USD_PER_SECOND = process.env.RILL_USD_PER_SECOND || "0.0001"; // $0.36/hr
const STREAM_ID = "xrp-usd-feed";
const TICK_WINDOW_SECONDS = 120;

const chain = CHAIN_ID === 114 ? coston2 : flare;
const publicClient = createPublicClient({ chain, transport: viemHttp(process.env.RILL_RPC_URL) });

const store = new MemoryStore();
const meter = new StreamingMeter(store, { payTo: DEFAULT_PAY_TO, maxTickSeconds: TICK_WINDOW_SECONDS });

const live = facilitatorKeyConfigured() && SHIM_ADDRESS && PAY_TO;
const provider = live
  ? new Fxrp3009SettlementProvider({ chainId: CHAIN_ID, shimAddress: SHIM_ADDRESS! })
  : new MockSettlementProvider();

console.log(`[demo] settlement mode: ${live ? `LIVE (${provider.network})` : "MOCK (no RILL_FACILITATOR_KEY / RILL_SHIM_ADDRESS / RILL_PAYEE_ADDRESS set)"}`);

let latestPrice: XrpUsdPrice | undefined;
async function refreshPriceAndRate() {
  try {
    latestPrice = await getXrpUsdPrice(publicClient);
    const ratePerSecond = usdPerSecondToFxrpPerSecond(USD_PER_SECOND, latestPrice);
    store.addStream({
      id: STREAM_ID,
      title: "Live XRP/USD FTSO feed",
      description: `$${USD_PER_SECOND}/second, settled in FXRP at the live FTSOv2 rate`,
      ratePerSecond,
      asset: "FXRP",
      provider: "Rill demo",
      payTo: DEFAULT_PAY_TO,
    });
  } catch (err) {
    console.error("[demo] failed to refresh FTSO price:", (err as Error).message);
  }
}

/** Stashed quotes awaiting a client signature, keyed by session id. Single-use. */
const pendingQuotes = new Map<string, TickQuote>();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), "public"), { index: "console.html" }));

const fail = (res: Response, e: unknown) => {
  if (e instanceof MeterError) return res.status(e.status).json({ error: e.message });
  return res.status(500).json({ error: (e as Error).message });
};

app.get("/streams", (_req, res) => res.json([...store.streams.values()]));

app.get("/price", (_req, res) => {
  if (!latestPrice) return res.status(503).json({ error: "price not yet loaded" });
  res.json({
    value: latestPrice.value.toString(),
    decimals: latestPrice.decimals,
    timestamp: latestPrice.timestamp.toString(),
    usd: Number(latestPrice.value) / 10 ** latestPrice.decimals,
  });
});

app.post("/sessions", (req: Request, res: Response) => {
  try {
    const { agent, policy, objective } = req.body ?? {};
    if (!agent) return res.status(400).json({ error: "agent is required" });
    res.status(201).json(meter.openSession(STREAM_ID, agent, { policy, objective }));
  } catch (e) {
    fail(res, e);
  }
});

/**
 * Two-phase tick. No body -> quote + 402. With `{authorization}` -> settle the
 * previously-quoted (never re-quoted) amount.
 */
app.post("/sessions/:id/tick", async (req: Request, res: Response) => {
  try {
    const auth = req.body?.authorization as PendingAuthorization | undefined;

    if (!auth) {
      const quote = meter.quoteTick(req.params.id);
      pendingQuotes.set(req.params.id, quote);
      return res.status(402).json({
        x402Version: 2,
        accepts: [
          {
            scheme: "exact",
            network: provider.network,
            asset: SHIM_ADDRESS ?? FXRP_ADDRESS[CHAIN_ID],
            amount: quote.amount,
            payTo: quote.stream.payTo ?? DEFAULT_PAY_TO,
            maxTimeoutSeconds: TICK_WINDOW_SECONDS,
            extra: { nonce: `0x${randomBytes(32).toString("hex")}`, validAfter: "0", validBefore: String(Math.floor(quote.at / 1000) + TICK_WINDOW_SECONDS) },
          },
        ],
      });
    }

    const quote = pendingQuotes.get(req.params.id);
    if (!quote) return res.status(409).json({ error: "no pending quote for this session — request a 402 first" });
    pendingQuotes.delete(req.params.id);

    if (live && provider instanceof Fxrp3009SettlementProvider) {
      provider.stage(req.params.id, auth);
    }

    const result = await provider.settle(quote);
    const { session, event } = meter.commitTick(quote, result);
    res.json({ session, settlement: event, data: latestPrice ? { xrpUsd: Number(latestPrice.value) / 10 ** latestPrice.decimals } : undefined });
  } catch (e) {
    fail(res, e);
  }
});

app.post("/sessions/:id/close", (req: Request, res: Response) => {
  try {
    res.json(meter.closeSession(req.params.id, req.body?.reason));
  } catch (e) {
    fail(res, e);
  }
});

app.get("/impact", (_req, res) => res.json(meter.impact()));

async function main() {
  await refreshPriceAndRate();
  setInterval(refreshPriceAndRate, 60_000).unref();

  const port = parseInt(process.env.PORT || "8403", 10);
  app.listen(port, () => console.log(`[demo] listening on :${port}`));
}

main();
