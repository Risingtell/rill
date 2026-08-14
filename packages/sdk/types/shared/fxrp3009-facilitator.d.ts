/**
 * Builds an x402Facilitator registered for FXRP3009's exact/EIP-3009 scheme on a
 * Flare network. Shared by packages/provider (meter402's in-process settlement) and
 * apps/facilitator (the standalone HTTP facilitator service) so both point at the same
 * signer-construction logic instead of drifting apart.
 */
import { type Hex } from "viem";
import { x402Facilitator } from "@x402/core/facilitator";
import type { FacilitatorEvmSigner } from "@x402/evm";
export interface Fxrp3009FacilitatorOptions {
    /** Facilitator's gas-paying key (hex, with or without 0x prefix). */
    privateKey: string;
    /** 114 for Coston2, 14 for Flare mainnet. */
    chainId: 114 | 14;
    rpcUrl?: string;
}
export interface Fxrp3009Facilitator {
    facilitator: x402Facilitator;
    signer: FacilitatorEvmSigner;
    network: string;
    facilitatorAddress: Hex;
    chainId: 114 | 14;
}
export declare function createFxrp3009Facilitator(opts: Fxrp3009FacilitatorOptions): Fxrp3009Facilitator;
