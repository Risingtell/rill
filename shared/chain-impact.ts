/**
 * Chain-derived impact feed: the console's numbers, read from Coston2 rather than
 * from this server's memory.
 *
 * The demo originally served /impact straight out of meter402's MemoryStore. That is
 * fine for a laptop demo and wrong for a judged one, for two reasons:
 *
 *   1. It is unverifiable. "Our server says it settled 40 payments" is a claim about
 *      a process nobody else can inspect. Reading the same numbers off the chain makes
 *      every figure on the console reproducible by anyone with a block explorer.
 *   2. It does not survive. Judging runs a week after submission, on serverless
 *      infrastructure where process memory is discarded between cold starts. Anything
 *      held in RAM shows up as zeros to whoever opens the link on day six.
 *
 * So the feed is reconstructed from two Blockscout queries joined on transaction hash:
 *   - FXRP ERC-20 transfers into the payee address, which give payer, amount and time
 *   - FXRP3009's own AuthorizationUsed logs, which give the nonce, and therefore the
 *     metered duration that shared/tick-nonce.ts encoded into it
 *
 * The Coston2 RPC caps eth_getLogs at 30 blocks, which is useless for aggregates, so
 * this deliberately uses the explorer's REST API instead of an RPC log scan.
 */

import type { Hex } from "viem";
import { explorerTxUrl, coston2, flare } from "./flare-chains.js";
import { decodeTickNonceMs } from "./tick-nonce.js";

export interface ChainImpactOptions {
  chainId: 114 | 14;
  /** Provider address that receives stream payments. */
  payee: Hex;
  /** Deployed FXRP3009 shim, whose AuthorizationUsed logs carry the tick nonces. */
  shimAddress: Hex;
  /** FXRP token, used to filter out any unrelated ERC-20 sent to the payee. */
  fxrpAddress: Hex;
  /** Most recent settlements to return in `recent`. */
  recentLimit?: number;
  /** Pages of explorer results to walk. One page is 50 transfers. */
  maxPages?: number;
}

export interface ChainSettlement {
  id: string;
  agent: string;
  payTo: string;
  amount: string;
  amountFormatted: string;
  asset: string;
  decimals: number;
  /** Seconds of stream this tick paid for, decoded from the on-chain nonce. */
  seconds?: number;
  /** The nonce as emitted by AuthorizationUsed, so a judge can check the decode. */
  nonce?: string;
  network: string;
  txHash: string;
  explorerUrl: string;
  settledAt: number;
}

export interface ChainImpact {
  network: string;
  mock: false;
  source: "chain";
  /** Everything below is reconstructed from these, so judges can re-run the queries. */
  verifiedFrom: { explorer: string; payee: string; shim: string; token: string };
  totals: {
    settlements: number;
    totalPaid: string;
    totalPaidFormatted: string;
    asset: string;
    uniqueAgents: number;
    secondsStreamed: number;
    /** Settlements whose duration could be decoded from the nonce. */
    durationsOnChain: number;
  };
  recent: ChainSettlement[];
}

interface TransferItem {
  from?: { hash?: string };
  to?: { hash?: string };
  token?: { address_hash?: string; symbol?: string; name?: string; decimals?: string };
  total?: { value?: string; decimals?: string };
  transaction_hash?: string;
  timestamp?: string;
  method?: string;
}

interface LogItem {
  transaction_hash?: string;
  decoded?: { method_call?: string; parameters?: Array<{ name?: string; value?: string }> };
}

function explorerBase(chainId: 114 | 14): string {
  return (chainId === 114 ? coston2 : flare).blockExplorers.default.url;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`explorer ${res.status} for ${url}`);
  return (await res.json()) as T;
}

/** Walk paginated Blockscout results up to `maxPages`. */
async function getPaged<T>(baseUrl: string, maxPages: number): Promise<T[]> {
  const items: T[] = [];
  let next: Record<string, string> | undefined;

  for (let page = 0; page < maxPages; page++) {
    const qs = new URLSearchParams(next ?? {}).toString();
    const url = qs ? `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}${qs}` : baseUrl;
    const body = await getJson<{ items?: T[]; next_page_params?: Record<string, string> | null }>(url);
    items.push(...(body.items ?? []));
    if (!body.next_page_params) break;
    next = body.next_page_params;
  }

  return items;
}

function formatUnits(value: string, decimals: number): string {
  const negative = value.startsWith("-");
  const digits = (negative ? value.slice(1) : value).padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = decimals === 0 ? "" : digits.slice(digits.length - decimals).replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

/**
 * Rebuild the impact feed from chain state.
 *
 * Throws if the explorer is unreachable. Callers surface that as an explicit error
 * rather than an empty feed, because a console showing a confident zero is worse than
 * one saying it could not reach the explorer.
 */
export async function fetchChainImpact(opts: ChainImpactOptions): Promise<ChainImpact> {
  const { chainId, payee, shimAddress, fxrpAddress } = opts;
  const recentLimit = opts.recentLimit ?? 25;
  const maxPages = opts.maxPages ?? 4;
  const base = explorerBase(chainId);
  const network = chainId === 114 ? "eip155:114" : "eip155:14";

  const [transfers, logs] = await Promise.all([
    getPaged<TransferItem>(`${base}/api/v2/addresses/${payee}/token-transfers?type=ERC-20`, maxPages),
    getPaged<LogItem>(`${base}/api/v2/addresses/${shimAddress}/logs`, maxPages),
  ]);

  // tx hash -> nonce, from the shim's own AuthorizationUsed events.
  const nonceByTx = new Map<string, string>();
  for (const log of logs) {
    if (!log.decoded?.method_call?.startsWith("AuthorizationUsed")) continue;
    const nonce = log.decoded.parameters?.find((p) => p.name === "nonce")?.value;
    const tx = log.transaction_hash?.toLowerCase();
    if (nonce && tx) nonceByTx.set(tx, nonce);
  }

  const wantToken = fxrpAddress.toLowerCase();
  const wantPayee = payee.toLowerCase();

  const settlements: ChainSettlement[] = [];
  for (const t of transfers) {
    const tx = t.transaction_hash?.toLowerCase();
    const token = t.token?.address_hash?.toLowerCase();
    const to = t.to?.hash?.toLowerCase();
    const amount = t.total?.value;
    if (!tx || token !== wantToken || to !== wantPayee || !amount) continue;
    // Only count transfers the shim actually settled, not plain transfers someone
    // sent to the same address.
    if (!nonceByTx.has(tx)) continue;

    const decimals = parseInt(t.total?.decimals ?? t.token?.decimals ?? "6", 10);
    const nonce = nonceByTx.get(tx);
    const ms = nonce ? decodeTickNonceMs(nonce) : undefined;

    settlements.push({
      id: `${tx}:${settlements.length}`,
      agent: t.from?.hash ?? "",
      payTo: t.to?.hash ?? payee,
      amount,
      amountFormatted: formatUnits(amount, decimals),
      asset: t.token?.name === "FXRP" ? "FXRP" : (t.token?.symbol ?? "FXRP"),
      decimals,
      seconds: ms === undefined ? undefined : ms / 1000,
      nonce,
      network,
      txHash: tx,
      explorerUrl: explorerTxUrl(chainId, tx),
      settledAt: t.timestamp ? Date.parse(t.timestamp) : 0,
    });
  }

  settlements.sort((a, b) => b.settledAt - a.settledAt);

  const totalPaid = settlements.reduce((sum, s) => sum + BigInt(s.amount), 0n).toString();
  const decimals = settlements[0]?.decimals ?? 6;
  const withDuration = settlements.filter((s) => s.seconds !== undefined);

  return {
    network,
    mock: false,
    source: "chain",
    verifiedFrom: { explorer: base, payee, shim: shimAddress, token: fxrpAddress },
    totals: {
      settlements: settlements.length,
      totalPaid,
      totalPaidFormatted: formatUnits(totalPaid, decimals),
      asset: settlements[0]?.asset ?? "FXRP",
      uniqueAgents: new Set(settlements.map((s) => s.agent.toLowerCase())).size,
      secondsStreamed: withDuration.reduce((sum, s) => sum + (s.seconds ?? 0), 0),
      durationsOnChain: withDuration.length,
    },
    recent: settlements.slice(0, recentLimit),
  };
}
