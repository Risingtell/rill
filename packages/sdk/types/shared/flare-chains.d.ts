/**
 * Flare network config for viem, and the FXRP3009 deployment addresses per network.
 * RPC URLs, chain IDs, and explorer URLs confirmed against the official
 * flare-foundation/flare-hardhat-starter hardhat.config.ts (see SPEC.md).
 */
export declare const COSTON2_CAIP2 = "eip155:114";
export declare const FLARE_CAIP2 = "eip155:14";
export declare const coston2: {
    blockExplorers: {
        readonly default: {
            readonly name: "Coston2 Explorer";
            readonly url: "https://coston2-explorer.flare.network";
        };
    };
    blockTime?: number | undefined | undefined;
    contracts?: {
        [x: string]: import("viem").ChainContract | {
            [sourceId: number]: import("viem").ChainContract | undefined;
        } | undefined;
        ensRegistry?: import("viem").ChainContract | undefined;
        ensUniversalResolver?: import("viem").ChainContract | undefined;
        multicall3?: import("viem").ChainContract | undefined;
        erc6492Verifier?: import("viem").ChainContract | undefined;
    } | undefined;
    ensTlds?: readonly string[] | undefined;
    id: 114;
    name: "Flare Testnet Coston2";
    nativeCurrency: {
        readonly name: "Coston2 Spark";
        readonly symbol: "C2FLR";
        readonly decimals: 18;
    };
    experimental_preconfirmationTime?: number | undefined | undefined;
    rpcUrls: {
        readonly default: {
            readonly http: readonly ["https://coston2-api.flare.network/ext/C/rpc"];
        };
    };
    sourceId?: number | undefined | undefined;
    supportsTransactionReplacementDetection?: boolean | undefined | undefined;
    testnet: true;
    custom?: Record<string, unknown> | undefined;
    extendSchema?: Record<string, unknown> | undefined;
    fees?: import("viem").ChainFees<undefined> | undefined;
    formatters?: undefined;
    prepareTransactionRequest?: ((args: import("viem").PrepareTransactionRequestParameters, options: {
        client: import("viem").Client;
        phase: "beforeFillTransaction" | "beforeFillParameters" | "afterFillParameters";
    }) => Promise<import("viem").PrepareTransactionRequestParameters>) | [fn: ((args: import("viem").PrepareTransactionRequestParameters, options: {
        client: import("viem").Client;
        phase: "beforeFillTransaction" | "beforeFillParameters" | "afterFillParameters";
    }) => Promise<import("viem").PrepareTransactionRequestParameters>) | undefined, options: {
        runAt: readonly ("beforeFillTransaction" | "beforeFillParameters" | "afterFillParameters")[];
    }] | undefined;
    serializers?: import("viem").ChainSerializers<undefined, import("viem").TransactionSerializable> | undefined;
    verifyHash?: ((client: import("viem").Client, parameters: import("viem").VerifyHashActionParameters) => Promise<import("viem").VerifyHashActionReturnType>) | undefined;
};
export declare const flare: {
    blockExplorers: {
        readonly default: {
            readonly name: "Flare Explorer";
            readonly url: "https://flare-explorer.flare.network";
        };
    };
    blockTime?: number | undefined | undefined;
    contracts?: {
        [x: string]: import("viem").ChainContract | {
            [sourceId: number]: import("viem").ChainContract | undefined;
        } | undefined;
        ensRegistry?: import("viem").ChainContract | undefined;
        ensUniversalResolver?: import("viem").ChainContract | undefined;
        multicall3?: import("viem").ChainContract | undefined;
        erc6492Verifier?: import("viem").ChainContract | undefined;
    } | undefined;
    ensTlds?: readonly string[] | undefined;
    id: 14;
    name: "Flare Mainnet";
    nativeCurrency: {
        readonly name: "Flare";
        readonly symbol: "FLR";
        readonly decimals: 18;
    };
    experimental_preconfirmationTime?: number | undefined | undefined;
    rpcUrls: {
        readonly default: {
            readonly http: readonly ["https://flare-api.flare.network/ext/C/rpc"];
        };
    };
    sourceId?: number | undefined | undefined;
    supportsTransactionReplacementDetection?: boolean | undefined | undefined;
    testnet?: boolean | undefined | undefined;
    custom?: Record<string, unknown> | undefined;
    extendSchema?: Record<string, unknown> | undefined;
    fees?: import("viem").ChainFees<undefined> | undefined;
    formatters?: undefined;
    prepareTransactionRequest?: ((args: import("viem").PrepareTransactionRequestParameters, options: {
        client: import("viem").Client;
        phase: "beforeFillTransaction" | "beforeFillParameters" | "afterFillParameters";
    }) => Promise<import("viem").PrepareTransactionRequestParameters>) | [fn: ((args: import("viem").PrepareTransactionRequestParameters, options: {
        client: import("viem").Client;
        phase: "beforeFillTransaction" | "beforeFillParameters" | "afterFillParameters";
    }) => Promise<import("viem").PrepareTransactionRequestParameters>) | undefined, options: {
        runAt: readonly ("beforeFillTransaction" | "beforeFillParameters" | "afterFillParameters")[];
    }] | undefined;
    serializers?: import("viem").ChainSerializers<undefined, import("viem").TransactionSerializable> | undefined;
    verifyHash?: ((client: import("viem").Client, parameters: import("viem").VerifyHashActionParameters) => Promise<import("viem").VerifyHashActionReturnType>) | undefined;
};
/** FXRP proxy addresses, confirmed on-chain (SPEC.md section 1). */
export declare const FXRP_ADDRESS: Record<114 | 14, `0x${string}`>;
/**
 * Deployed FXRP3009 shims, source-verified on each network's explorer.
 * Coston2 carries the live demo's settlement history; mainnet is deployed against real
 * FXRP, which has the same EIP-3009 gap (re-verified on-chain 2026-08-14).
 */
export declare const FXRP3009_ADDRESS: Record<114 | 14, `0x${string}`>;
export declare function explorerTxUrl(chainId: 114 | 14, txHash: string): string;
