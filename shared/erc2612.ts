/**
 * Minimal EIP-2612 `permit` relay. FXRP has `permit` but the payer has no gas token to
 * submit it themselves. Any relayer can submit a validly-signed permit on someone
 * else's behalf, since the signature alone authorizes the allowance. The facilitator
 * sponsors this one call per session (see SPEC.md section 2: "exactly one permit per
 * session, at open"); every tick after that is a pure EIP-3009 authorization against
 * the resulting allowance.
 */

import type { Hex } from "viem";
import type { FacilitatorEvmSigner } from "@x402/evm";

export const PERMIT_ABI = [
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

export interface PermitAuthorization {
  token: Hex;
  owner: Hex;
  spender: Hex;
  value: string;
  deadline: string;
  v: number;
  r: Hex;
  s: Hex;
}

export async function sponsorPermit(signer: FacilitatorEvmSigner, auth: PermitAuthorization): Promise<Hex> {
  const txHash = await signer.writeContract({
    address: auth.token,
    abi: PERMIT_ABI,
    functionName: "permit",
    args: [auth.owner, auth.spender, BigInt(auth.value), BigInt(auth.deadline), auth.v, auth.r, auth.s],
  });
  const receipt = await signer.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") throw new Error(`permit relay reverted (${txHash})`);
  return txHash;
}
