/**
 * fxrp3009: EIP-3009 authorizations for Flare's FXRP.
 *
 * FXRP has EIP-2612 `permit` but none of EIP-3009, so no standard x402 client or
 * facilitator can move it. This package is both halves of the fix: a payer-side client
 * that signs standard authorizations while holding no gas token, and the server-side
 * pieces that verify and settle them through the real @x402/evm scheme implementation.
 *
 * Nothing here is Rill-specific. The contract is a plain EIP-3009 shim over any ERC-20
 * that has `permit` and lacks EIP-3009, which is every FAsset today.
 */
export { Fxrp3009Client, randomNonce } from "./client.js";
export type { Fxrp3009ClientOptions, SignedAuthorization, PaymentRequirement, } from "./client.js";
export { coston2, flare, CHAINS, FXRP_ADDRESS, FXRP3009_ADDRESS, FXRP_DECIMALS, ERC20_ABI, FXRP3009_ABI, PERMIT_TYPES, TRANSFER_AUTH_TYPES, } from "./constants.js";
export type { FlareChainId } from "./constants.js";
/**
 * Tick nonces: an EIP-3009 nonce that carries how long a metered tick paid for.
 *
 * The nonce is required to be unique and is emitted as an indexed topic anyway, so the
 * low 6 bytes are spent on the duration in milliseconds behind a 0x524C marker. Per
 * second metering data therefore lands on chain at no extra gas, and any consumer can
 * recompute a provider's totals from block explorer data alone.
 */
export { encodeTickNonce, decodeTickNonceMs } from "../../../shared/tick-nonce.js";
/** Rebuild a provider's settlement history from chain state, trusting no server. */
export { fetchChainImpact } from "../../../shared/chain-impact.js";
export type { ChainImpact, ChainSettlement, ChainImpactOptions } from "../../../shared/chain-impact.js";
/** Server side: an x402 facilitator wired to the shim, and a meter402 provider. */
export { createFxrp3009Facilitator } from "../../../shared/fxrp3009-facilitator.js";
export type { Fxrp3009Facilitator, Fxrp3009FacilitatorOptions } from "../../../shared/fxrp3009-facilitator.js";
export { Fxrp3009SettlementProvider, facilitatorKeyConfigured } from "../../provider/index.js";
export type { Fxrp3009SettlementProviderOptions, PendingAuthorization, Eip712DomainInfo, } from "../../provider/index.js";
