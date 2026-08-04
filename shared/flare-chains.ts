/**
 * Flare network config for viem, and the FXRP3009 deployment addresses per network.
 * RPC URLs, chain IDs, and explorer URLs confirmed against the official
 * flare-foundation/flare-hardhat-starter hardhat.config.ts (see SPEC.md).
 */

import { defineChain } from "viem";

export const COSTON2_CAIP2 = "eip155:114";
export const FLARE_CAIP2 = "eip155:14";

export const coston2 = defineChain({
  id: 114,
  name: "Flare Testnet Coston2",
  nativeCurrency: { name: "Coston2 Spark", symbol: "C2FLR", decimals: 18 },
  rpcUrls: { default: { http: ["https://coston2-api.flare.network/ext/C/rpc"] } },
  blockExplorers: {
    default: { name: "Coston2 Explorer", url: "https://coston2-explorer.flare.network" },
  },
  testnet: true,
});

export const flare = defineChain({
  id: 14,
  name: "Flare Mainnet",
  nativeCurrency: { name: "Flare", symbol: "FLR", decimals: 18 },
  rpcUrls: { default: { http: ["https://flare-api.flare.network/ext/C/rpc"] } },
  blockExplorers: {
    default: { name: "Flare Explorer", url: "https://flare-explorer.flare.network" },
  },
});

/** FXRP proxy addresses, confirmed on-chain (SPEC.md section 1). */
export const FXRP_ADDRESS: Record<114 | 14, `0x${string}`> = {
  114: "0x0b6A3645c240605887a5532109323A3E12273dc7",
  14: "0xAd552A648C74D49E10027AB8a618A3ad4901c5bE",
};

export function explorerTxUrl(chainId: 114 | 14, txHash: string): string {
  const chain = chainId === 114 ? coston2 : flare;
  return `${chain.blockExplorers.default.url}/tx/${txHash}`;
}
