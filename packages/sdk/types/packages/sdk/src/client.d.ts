/**
 * Fxrp3009Client: pay for x402-metered resources in FXRP while holding no gas token.
 *
 * FXRP implements EIP-2612 `permit` but none of EIP-3009, so no standard x402 client
 * can move it. The FXRP3009 shim supplies the missing half. This client is the payer
 * side of that: it signs, and it never broadcasts. Every on-chain transaction its
 * payments cause is submitted and paid for by a facilitator.
 *
 * The whole flow in one call:
 *
 *   const client = new Fxrp3009Client({ account, chainId: 114 });
 *   await client.openSession({ budget: 1_000_000n });   // one gasless permit
 *   const data = await client.fetchPaid("https://provider.example/stream");
 *
 * `fetchPaid` speaks standard x402: it takes the 402, reads the payment requirements,
 * signs an EIP-3009 authorization for exactly the quoted amount, and resubmits. A
 * server does not have to know anything about this library for it to work.
 */
import { type Account, type Hex } from "viem";
import { type FlareChainId } from "./constants.js";
export interface Fxrp3009ClientOptions {
    /** A viem account. Only ever used to sign; this client never sends a transaction. */
    account: Account;
    /** 114 for Coston2, 14 for Flare mainnet. */
    chainId: FlareChainId;
    /** Deployed FXRP3009 shim. Defaults to the published deployment for the network. */
    shimAddress?: Hex;
    /** Facilitator that sponsors gas. Required for openSession(). */
    facilitatorUrl?: string;
    rpcUrl?: string;
}
/** A signed EIP-3009 authorization: a complete payment instruction anyone can submit. */
export interface SignedAuthorization {
    from: Hex;
    to: Hex;
    value: string;
    validAfter: string;
    validBefore: string;
    nonce: Hex;
    signature: Hex;
}
/** The x402 payment requirements a resource server returns with its 402. */
export interface PaymentRequirement {
    scheme?: string;
    network?: string;
    asset?: Hex;
    amount: string;
    payTo: Hex;
    maxTimeoutSeconds?: number;
    extra?: {
        name?: string;
        version?: string;
        nonce?: Hex;
        validAfter?: string;
        validBefore?: string;
        [key: string]: unknown;
    };
}
export declare class Fxrp3009Client {
    readonly address: Hex;
    readonly chainId: FlareChainId;
    readonly shimAddress: Hex;
    private readonly account;
    private readonly publicClient;
    private readonly facilitatorUrl?;
    constructor(opts: Fxrp3009ClientOptions);
    /** FXRP balance in smallest units (6 decimals). */
    fxrpBalance(address?: Hex): Promise<bigint>;
    /** Native gas balance in wei. For a correctly-operating payer this stays at zero. */
    gasBalance(address?: Hex): Promise<bigint>;
    /** How much the shim is currently allowed to move on this payer's behalf. */
    allowance(): Promise<bigint>;
    /**
     * Sign one EIP-2612 permit covering a session's whole budget.
     *
     * Deliberately once per session rather than once per payment: EIP-2612 nonces are
     * sequential and race under concurrency, while the EIP-3009 nonces used for each
     * subsequent tick are random and do not.
     */
    signPermit(opts: {
        budget: bigint;
        deadlineSeconds?: number;
    }): Promise<{
        owner: Hex;
        value: string;
        deadline: string;
        v: number;
        r: Hex;
        s: Hex;
    }>;
    /**
     * Open a session: sign the permit and have the facilitator put it on chain.
     * Returns the sponsoring transaction hash. The payer still spends no gas.
     */
    openSession(opts: {
        budget: bigint;
        deadlineSeconds?: number;
    }): Promise<string>;
    /**
     * Sign an EIP-3009 authorization matching a server's payment requirement.
     *
     * The EIP-712 domain comes from the requirement, not from a constant compiled in
     * here: that is what makes this a standard x402 client rather than one that only
     * talks to servers it was built against.
     */
    signAuthorization(req: PaymentRequirement): Promise<SignedAuthorization>;
    /**
     * Fetch a resource, paying for it if it answers 402.
     *
     * Standard x402: read `accepts`, sign the first requirement this client can satisfy,
     * resubmit. Servers need no knowledge of this library.
     *
     * The retry keeps the caller's method, which matters more than it looks. x402's own
     * convention carries payment in the `X-PAYMENT` header precisely so a paid GET stays
     * a GET, but plenty of metered endpoints are POST-only and read the authorization
     * from the body instead. Sending the header always, and the body only when the
     * method allows one, means this works against both without the caller choosing.
     */
    fetchPaid(url: string, init?: RequestInit): Promise<Response>;
}
/** A random EIP-3009 nonce, for servers that do not issue one themselves. */
export declare function randomNonce(): Hex;
