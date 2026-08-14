/**
 * Fxrp3009SettlementProvider: meter402's SettlementProvider, backed by the FXRP3009
 * shim (contracts/FXRP3009.sol) instead of a plain ERC-20 transfer.
 *
 * Unlike Spigot's ArcEoaSettlementProvider (agent signs AND broadcasts with its own
 * gas), the whole point of FXRP3009 is that the agent never holds a gas token. The
 * agent signs a standard EIP-3009 authorization off-chain, free, and hands it to
 * this provider, which holds the facilitator's gas-paying key and broadcasts
 * `transferWithAuthorization` on the agent's behalf. meter402's split of
 * quoteTick()/settle() has no room for a signature parameter, so `stage()` is the
 * bridge: the HTTP layer stashes the agent's per-tick authorization here right before
 * triggering the existing quoteTick -> settle -> commitTick sequence.
 *
 * verify()/settle() are @x402/evm's real ExactEvmScheme implementation, not a
 * hand-rolled check. The same code a stock x402 facilitator runs against USDC on
 * Base runs here against FXRP3009 on Flare (see shared/fxrp3009-facilitator.ts).
 * That is the whole thesis: SPEC.md section 2.
 */
import type { Hex } from "viem";
import type { SettlementProvider, SettlementResult, TickQuote } from "meter402";
/** The agent's signed EIP-3009 authorization for one specific tick. */
export interface PendingAuthorization {
    from: Hex;
    to: Hex;
    value: string;
    validAfter: string;
    validBefore: string;
    nonce: Hex;
    signature: Hex;
}
/** The EIP-712 domain an x402 `exact` payment must be signed under. */
export interface Eip712DomainInfo {
    name: string;
    version: string;
}
export interface Fxrp3009SettlementProviderOptions {
    /** Facilitator's gas-paying key. Falls back to RILL_FACILITATOR_KEY. */
    facilitatorPrivateKey?: string;
    /** 114 for Coston2, 14 for Flare mainnet. */
    chainId: 114 | 14;
    /** Deployed FXRP3009 shim address. */
    shimAddress: Hex;
    rpcUrl?: string;
}
/** True when a facilitator key is configured, so real settlement is possible. */
export declare function facilitatorKeyConfigured(): boolean;
export declare class Fxrp3009SettlementProvider implements SettlementProvider {
    readonly network: string;
    readonly mock = false;
    readonly facilitatorAddress: Hex;
    private readonly pending;
    private readonly fac;
    private readonly shimAddress;
    private domain;
    constructor(opts: Fxrp3009SettlementProviderOptions);
    /**
     * The EIP-712 domain the shim signs under, read from the contract itself via
     * ERC-5267 and cached for the process lifetime (it is immutable once deployed).
     *
     * x402's exact/EIP-3009 verifier refuses any payment whose requirements do not
     * carry `extra.name` and `extra.version`: without them it cannot rebuild the
     * digest the payer signed. Resource servers must therefore advertise the domain in
     * their 402, which is exactly what apps/demo does with this value.
     */
    eip712Domain(): Promise<Eip712DomainInfo>;
    /**
     * Stash the agent's signed authorization for `sessionId`'s next tick.
     *
     * `expectedNonce` is the nonce the resource server put in its 402 response. Passing
     * it binds the settlement to that exact nonce: see the check in settle() for why
     * that matters.
     */
    stage(sessionId: string, auth: PendingAuthorization, expectedNonce?: Hex): void;
    settle(quote: TickQuote): Promise<SettlementResult>;
}
