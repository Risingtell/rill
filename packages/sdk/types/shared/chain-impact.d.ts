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
    /** Pages of explorer results to walk. One page is 50 items. */
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
    /** True when the explorer had more history than we walked, so totals are a floor
     *  rather than the complete picture. Surfaced instead of silently under-reporting. */
    truncated: boolean;
    /** Everything below is reconstructed from these, so judges can re-run the queries. */
    verifiedFrom: {
        explorer: string;
        payee: string;
        shim: string;
        token: string;
    };
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
/**
 * Rebuild the impact feed from chain state.
 *
 * Throws if the explorer is unreachable. Callers surface that as an explicit error
 * rather than an empty feed, because a console showing a confident zero is worse than
 * one saying it could not reach the explorer.
 */
export declare function fetchChainImpact(opts: ChainImpactOptions): Promise<ChainImpact>;
