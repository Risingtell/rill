/**
 * Rill demo resource server: pay-per-second access to a live FTSOv2 XRP/USD feed,
 * settled in real FXRP through the FXRP3009 shim.
 *
 * Ticks are two-phase, not one-shot, because meter402's quoteTick() is a pure
 * computation of elapsed wall-clock time. If the server re-quoted after the client
 * signs, the signed amount and the settled amount could drift apart on every request.
 * So the server quotes once, stashes that exact quote, and returns it as a standard
 * x402 402 Payment Required response; the client signs an EIP-3009 authorization for
 * that exact amount and resubmits; the server settles the STASHED quote, never a fresh
 * one, so the signed amount and the settled amount are always identical.
 *
 * Two things here are shaped by where this runs. Judging happens a week after
 * submission, on a host that discards process memory between cold starts, so:
 *   - the FTSO price is fetched lazily behind a TTL rather than on a setInterval,
 *     because background timers do not survive on serverless
 *   - /impact is read back off the chain (shared/chain-impact.ts), not out of
 *     meter402's in-memory store, so the console reports numbers a judge can
 *     reproduce from a block explorer and that do not reset to zero on a cold start
 */

import "dotenv/config";
import { fileURLToPath } from "node:url";
import path from "node:path";
import express, { type Request, type Response } from "express";
import cors from "cors";
import { createPublicClient, http as viemHttp, type Hex } from "viem";
import { StreamingMeter, MemoryStore, MockSettlementProvider, MeterError, type TickQuote, type Session } from "meter402";
import { Fxrp3009SettlementProvider, facilitatorKeyConfigured, type PendingAuthorization } from "../../packages/provider/index.js";
import { coston2, flare, FXRP_ADDRESS } from "../../shared/flare-chains.js";
import { getXrpUsdPrice, usdPerSecondToFxrpPerSecond, type XrpUsdPrice } from "../../shared/ftso.js";
import { encodeTickNonce } from "../../shared/tick-nonce.js";
import { resolveSessionSecret, signToken, verifyToken } from "../../shared/session-token.js";
import { fetchChainImpact, type ChainImpact } from "../../shared/chain-impact.js";

const CHAIN_ID = (parseInt(process.env.RILL_CHAIN_ID || "114", 10) === 14 ? 14 : 114) as 114 | 14;
const SHIM_ADDRESS = process.env.RILL_SHIM_ADDRESS as Hex | undefined;
const PAY_TO = process.env.RILL_PAYEE_ADDRESS as Hex | undefined;
const DEFAULT_PAY_TO: Hex = PAY_TO ?? "0x000000000000000000000000000000000000dEaD";
const USD_PER_SECOND = process.env.RILL_USD_PER_SECOND || "0.0001"; // $0.36/hr
const STREAM_ID = "xrp-usd-feed";
const TICK_WINDOW_SECONDS = 120;
const PRICE_TTL_MS = 60_000;
const IMPACT_TTL_MS = 5_000;

const chain = CHAIN_ID === 114 ? coston2 : flare;
const publicClient = createPublicClient({ chain, transport: viemHttp(process.env.RILL_RPC_URL) });

const store = new MemoryStore();
const meter = new StreamingMeter(store, { payTo: DEFAULT_PAY_TO, maxTickSeconds: TICK_WINDOW_SECONDS });

const live = facilitatorKeyConfigured() && SHIM_ADDRESS && PAY_TO;
const provider = live
  ? new Fxrp3009SettlementProvider({ chainId: CHAIN_ID, shimAddress: SHIM_ADDRESS! })
  : new MockSettlementProvider();

console.log(`[demo] settlement mode: ${live ? `LIVE (${provider.network})` : "MOCK (no RILL_FACILITATOR_KEY / RILL_SHIM_ADDRESS / RILL_PAYEE_ADDRESS set)"}`);

/**
 * Latest FTSO price, refreshed on demand. A setInterval would be simpler but would
 * silently stop refreshing on any host that freezes the process between requests.
 */
let latestPrice: XrpUsdPrice | undefined;
let priceFetchedAt = 0;
let priceInFlight: Promise<void> | undefined;

async function ensurePrice(): Promise<XrpUsdPrice | undefined> {
  if (latestPrice && Date.now() - priceFetchedAt < PRICE_TTL_MS) return latestPrice;
  // Collapse concurrent refreshes so a burst of requests makes one FTSO read.
  priceInFlight ??= (async () => {
    try {
      latestPrice = await getXrpUsdPrice(publicClient);
      priceFetchedAt = Date.now();
    } catch (err) {
      console.error("[demo] failed to refresh FTSO price:", (err as Error).message);
    } finally {
      priceInFlight = undefined;
    }
  })();
  await priceInFlight;
  return latestPrice;
}

/** Register/refresh the stream at the current FTSO rate. Required before any tick. */
async function ensureStream(): Promise<void> {
  const price = await ensurePrice();
  if (!price) throw new MeterError(503, "FTSO price unavailable, cannot price the stream");
  store.addStream({
    id: STREAM_ID,
    title: "Live XRP/USD FTSO feed",
    description: `$${USD_PER_SECOND}/second, settled in FXRP at the live FTSOv2 rate`,
    ratePerSecond: usdPerSecondToFxrpPerSecond(USD_PER_SECOND, price),
    asset: "FXRP",
    provider: "Rill demo",
    payTo: DEFAULT_PAY_TO,
  });
}

/**
 * Session and quote state travel with the client as signed tokens instead of living in
 * process memory, because consecutive requests here are not guaranteed to reach the
 * same instance. See shared/session-token.ts for why replaying one gains nothing.
 */
const { secret: SESSION_SECRET, ephemeral: SECRET_IS_EPHEMERAL } = resolveSessionSecret();
if (SECRET_IS_EPHEMERAL) {
  console.warn("[demo] no RILL_SESSION_SECRET or RILL_FACILITATOR_KEY: session tokens are signed with a per-process key and will not survive a restart");
}

interface StashedQuote {
  quote: TickQuote;
  nonce: Hex;
}

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), "public"), { index: "console.html" }));

const fail = (res: Response, e: unknown) => {
  if (e instanceof MeterError) return res.status(e.status).json({ error: e.message });
  return res.status(500).json({ error: (e as Error).message });
};

app.get("/streams", async (_req, res) => {
  try {
    await ensureStream();
    res.json([...store.streams.values()]);
  } catch (e) {
    fail(res, e);
  }
});

app.get("/price", async (_req, res) => {
  const price = await ensurePrice();
  if (!price) return res.status(503).json({ error: "price not yet loaded" });
  res.json({
    value: price.value.toString(),
    decimals: price.decimals,
    timestamp: price.timestamp.toString(),
    usd: Number(price.value) / 10 ** price.decimals,
  });
});

app.post("/sessions", async (req: Request, res: Response) => {
  try {
    const { agent, policy, objective } = req.body ?? {};
    if (!agent) return res.status(400).json({ error: "agent is required" });
    await ensureStream();
    const session = meter.openSession(STREAM_ID, agent, { policy, objective });
    // The token IS the session id from the client's point of view: it carries the whole
    // session, signed, so no server-side lookup is needed on the next request.
    res.status(201).json({ ...session, id: signToken(SESSION_SECRET, session) });
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
    await ensureStream();

    if (!auth) {
      const session = verifyToken<Session>(SESSION_SECRET, req.params.id);
      if (!session) return res.status(404).json({ error: "unknown or tampered session token" });
      // Rehydrate the meter's view of this session for the life of this request only.
      store.putSession(session);
      const quote = meter.quoteTick(session.id);

      // A tick asked for too soon after the last one rounds to zero smallest-units.
      // Settling it would broadcast a real transaction, burn real gas and emit a
      // zero-value transfer, so refuse and tell the client how long to wait.
      if (BigInt(quote.amount) === 0n) {
        const rate = BigInt(quote.stream.ratePerSecond);
        // Wait for at least a second of stream rather than the bare minimum that
        // rounds above zero, so a retry buys a meaningful tick instead of a
        // transaction that moves a single smallest-unit.
        const minimumNonZeroMs = rate > 0n ? Math.ceil(1000 / Number(rate)) : 1000;
        const retryAfterMs = Math.max(1000, minimumNonZeroMs);
        return res.status(425).json({
          error: "too early: this tick would bill zero, wait for more stream time to accrue",
          retryAfterMs,
        });
      }

      // The nonce carries this tick's metered duration on-chain at no extra gas, so
      // the console's per-second numbers stay auditable. See shared/tick-nonce.ts.
      const nonce = encodeTickNonce(quote.elapsedMs);
      const quoteToken = signToken(SESSION_SECRET, { quote, nonce } satisfies StashedQuote);
      // x402's exact/EIP-3009 scheme requires the asset's EIP-712 domain name and
      // version in `extra`, so a client that has never heard of Rill can rebuild the
      // digest and sign. Read from the shim itself rather than hardcoded here.
      // In mock mode there is no deployed shim to ask, so state the domain FXRP3009's
      // constructor sets. A 402 should always carry it either way: the client contract
      // is uniform, and mock settlement does not check signatures regardless.
      const domain =
        live && provider instanceof Fxrp3009SettlementProvider
          ? await provider.eip712Domain()
          : { name: "FXRP3009", version: "1" };
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
            extra: {
              ...domain,
              nonce,
              validAfter: "0",
              validBefore: String(Math.floor(quote.at / 1000) + TICK_WINDOW_SECONDS),
              // Echo this back with the signed authorization. It pins the exact amount
              // quoted, so the settled amount can never drift from the signed one.
              quoteToken,
            },
          },
        ],
      });
    }

    const stashed = verifyToken<StashedQuote>(SESSION_SECRET, req.body?.quoteToken);
    if (!stashed) {
      return res.status(409).json({ error: "missing or invalid quoteToken, request a 402 quote first" });
    }

    // Settle the quote exactly as it was signed, rehydrated from the token.
    store.putSession(stashed.quote.session);

    if (live && provider instanceof Fxrp3009SettlementProvider) {
      provider.stage(stashed.quote.session.id, auth, stashed.nonce);
    }

    const result = await provider.settle(stashed.quote);
    const { session, event } = meter.commitTick(stashed.quote, result);
    // Hand back a fresh token: the next tick must build on this tick's state.
    res.json({
      session: { ...session, id: signToken(SESSION_SECRET, session) },
      settlement: event,
      data: latestPrice ? { xrpUsd: Number(latestPrice.value) / 10 ** latestPrice.decimals } : undefined,
    });
  } catch (e) {
    fail(res, e);
  }
});

app.post("/sessions/:id/close", (req: Request, res: Response) => {
  try {
    const session = verifyToken<Session>(SESSION_SECRET, req.params.id);
    if (!session) return res.status(404).json({ error: "unknown or tampered session token" });
    store.putSession(session);
    const closed = meter.closeSession(session.id, req.body?.reason);
    res.json({ ...closed, id: signToken(SESSION_SECRET, closed) });
  } catch (e) {
    fail(res, e);
  }
});

/**
 * The proof feed. In live mode every figure is reconstructed from Coston2, so the
 * console shows what the chain says rather than what this process remembers. Falls
 * back to the in-memory meter only in mock mode, where there is no chain to read.
 */
let impactCache: { at: number; value: ChainImpact } | undefined;

app.get("/impact", async (_req, res) => {
  if (!live || !PAY_TO || !SHIM_ADDRESS) {
    return res.json({ ...meter.impact(), source: "memory" });
  }

  if (impactCache && Date.now() - impactCache.at < IMPACT_TTL_MS) {
    return res.json(impactCache.value);
  }

  try {
    const value = await fetchChainImpact({
      chainId: CHAIN_ID,
      payee: PAY_TO,
      shimAddress: SHIM_ADDRESS,
      fxrpAddress: FXRP_ADDRESS[CHAIN_ID],
    });
    impactCache = { at: Date.now(), value };
    res.json(value);
  } catch (e) {
    // Serving a stale snapshot beats serving a confident zero.
    if (impactCache) return res.json({ ...impactCache.value, stale: true });
    res.status(503).json({ error: `could not read settlements from the explorer: ${(e as Error).message}` });
  }
});

/** Liveness probe, matching apps/facilitator so both services answer the same check. */
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    network: provider.network,
    mock: !live,
    shimAddress: SHIM_ADDRESS ?? null,
    payTo: live ? DEFAULT_PAY_TO : null,
  });
});

/** Config the console needs to render links and labels without hardcoding them. */
app.get("/config", (_req, res) => {
  res.json({
    chainId: CHAIN_ID,
    network: provider.network,
    mock: !live,
    shimAddress: SHIM_ADDRESS ?? null,
    payTo: live ? DEFAULT_PAY_TO : null,
    fxrpAddress: FXRP_ADDRESS[CHAIN_ID],
    explorer: chain.blockExplorers.default.url,
    usdPerSecond: USD_PER_SECOND,
  });
});

export default app;
export { ensureStream };
