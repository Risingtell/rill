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

  /**
   * Settlement gas varies with how much of the storage it touches is already warm:
   * the payer's authorization slot, the FXRP allowance slot and both balance slots are
   * all cheaper on a second visit. eth_estimateGas runs against pending state, so a
   * tick estimated right after a previous tick can be quoted a warm-path price and
   * then hit cold-path costs when it actually executes a block later. That runs the
   * transaction out of gas, and out-of-gas reverts with empty data, which surfaces as
   * an opaque "transaction failed" with no reason attached.
   *
   * Observed live on Coston2: a tick estimated at 119,742 consumed 117,957 and
   * reverted, while its neighbour ran fine with a 166,348 limit. So add headroom
   * rather than trusting a bare estimate. Unused gas is refunded, so the only cost of
   * the margin is a slightly higher balance requirement on the fee payer.
   */
  const GAS_HEADROOM_NUMERATOR = 15n;
  const GAS_HEADROOM_DENOMINATOR = 10n;

  async function withGasHeadroom(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (args.gas !== undefined) return args;
    try {
      const estimate = await publicClient.estimateContractGas({ ...args, account } as never);
      return { ...args, gas: (estimate * GAS_HEADROOM_NUMERATOR) / GAS_HEADROOM_DENOMINATOR };
    } catch {
      // Estimation failed for its own reasons: hand it to the wallet client unchanged
      // and let the normal error path report why.
      return args;
    }
  }

  const signer: FacilitatorEvmSigner = {
    getAddresses: () => [account.address],
    readContract: (args) => publicClient.readContract(args as never),
    verifyTypedData: (args) => publicClient.verifyTypedData(args as never),
    writeContract: async (args) =>
      walletClient.writeContract({ ...(await withGasHeadroom(args as unknown as Record<string, unknown>)), chain, account } as never),
    sendTransaction: (args) => walletClient.sendTransaction({ ...args, chain, account } as never),
    waitForTransactionReceipt: (args) => publicClient.waitForTransactionReceipt(args),
    getCode: (args) => publicClient.getCode(args),
  };

  const facilitator = new x402Facilitator();
  registerExactEvmScheme(facilitator, { networks: network as never, signer });

  return { facilitator, signer, network, facilitatorAddress: account.address, chainId: opts.chainId };
}
