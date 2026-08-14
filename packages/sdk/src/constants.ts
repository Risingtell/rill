/**
 * Addresses, chains and ABIs, all confirmed on-chain rather than copied from docs.
 *
 * The FXRP addresses were checked on both networks by calling them: `nonces` answers
 * (EIP-2612 present) and `authorizationState` reverts (EIP-3009 absent). That gap is
 * the reason this package exists.
 */

import { defineChain, type Chain, type Hex } from "viem";

export type FlareChainId = 114 | 14;

export const coston2: Chain = defineChain({
  id: 114,
  name: "Flare Testnet Coston2",
  nativeCurrency: { name: "Coston2 Spark", symbol: "C2FLR", decimals: 18 },
  rpcUrls: { default: { http: ["https://coston2-api.flare.network/ext/C/rpc"] } },
  blockExplorers: { default: { name: "Coston2 Explorer", url: "https://coston2-explorer.flare.network" } },
  testnet: true,
});

export const flare: Chain = defineChain({
  id: 14,
  name: "Flare Mainnet",
  nativeCurrency: { name: "Flare", symbol: "FLR", decimals: 18 },
  rpcUrls: { default: { http: ["https://flare-api.flare.network/ext/C/rpc"] } },
  blockExplorers: { default: { name: "Flare Explorer", url: "https://flare-explorer.flare.network" } },
});

export const CHAINS: Record<FlareChainId, Chain> = { 114: coston2, 14: flare };

/** FXRP (FAssets) proxy addresses. */
export const FXRP_ADDRESS: Record<FlareChainId, Hex> = {
  114: "0x0b6A3645c240605887a5532109323A3E12273dc7",
  14: "0xAd552A648C74D49E10027AB8a618A3ad4901c5bE",
};

/** Deployed FXRP3009 shims, source-verified on each network's explorer. */
export const FXRP3009_ADDRESS: Record<FlareChainId, Hex> = {
  114: "0xf073D2f6cf681cc0E3a4d391f661a994Bd32aCFa",
  14: "0xb1a5826C3Ae8afDfB724D0DBaEEbAa4841605B86",
};

export const FXRP_DECIMALS = 6;

export const ERC20_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "nonces", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "permit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
      { name: "deadline", type: "uint256" },
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
    ],
    outputs: [],
  },
] as const;

/** The shim's own surface: standard EIP-3009, plus a mirrored Transfer (see README). */
export const FXRP3009_ABI = [
  {
    type: "function",
    name: "transferWithAuthorization",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "receiveWithAuthorization",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "cancelAuthorization",
    stateMutability: "nonpayable",
    inputs: [
      { name: "authorizer", type: "address" },
      { name: "nonce", type: "bytes32" },
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "authorizationState",
    stateMutability: "view",
    inputs: [{ type: "address" }, { type: "bytes32" }],
    outputs: [{ type: "bool" }],
  },
  { type: "function", name: "token", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  {
    type: "event",
    name: "AuthorizationUsed",
    inputs: [
      { name: "authorizer", type: "address", indexed: true },
      { name: "nonce", type: "bytes32", indexed: true },
    ],
  },
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
  },
] as const;

export const PERMIT_TYPES = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export const TRANSFER_AUTH_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;
