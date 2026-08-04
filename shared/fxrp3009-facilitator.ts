/**
 * Builds an x402Facilitator registered for FXRP3009's exact/EIP-3009 scheme on a
 * Flare network. Shared by packages/provider (meter402's in-process settlement) and
 * apps/facilitator (the standalone HTTP facilitator service) so both point at the same
 * signer-construction logic instead of drifting apart.
 */

import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { x402Facilitator } from "@x402/core/facilitator";
import { registerExactEvmScheme } from "@x402/evm/exact/facilitator";
import type { FacilitatorEvmSigner } from "@x402/evm";
import { coston2, flare, COSTON2_CAIP2, FLARE_CAIP2 } from "./flare-chains.js";

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

function normalizeKey(key: string): Hex {
  const trimmed = key.trim();
  return (trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`) as Hex;
}

export function createFxrp3009Facilitator(opts: Fxrp3009FacilitatorOptions): Fxrp3009Facilitator {
  const chain = opts.chainId === 114 ? coston2 : flare;
  const network = opts.chainId === 114 ? COSTON2_CAIP2 : FLARE_CAIP2;
  const account = privateKeyToAccount(normalizeKey(opts.privateKey));
  const transport = http(opts.rpcUrl);
  const publicClient = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({ account, chain, transport });

  const signer: FacilitatorEvmSigner = {
    getAddresses: () => [account.address],
    readContract: (args) => publicClient.readContract(args as never),
    verifyTypedData: (args) => publicClient.verifyTypedData(args as never),
    writeContract: (args) => walletClient.writeContract({ ...args, chain, account } as never),
    sendTransaction: (args) => walletClient.sendTransaction({ ...args, chain, account } as never),
    waitForTransactionReceipt: (args) => publicClient.waitForTransactionReceipt(args),
    getCode: (args) => publicClient.getCode(args),
  };

  const facilitator = new x402Facilitator();
  registerExactEvmScheme(facilitator, { networks: network as never, signer });

  return { facilitator, signer, network, facilitatorAddress: account.address, chainId: opts.chainId };
}
