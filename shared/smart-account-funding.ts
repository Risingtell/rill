/**
 * Flare Smart Accounts funding path: an XRPL holder sends one XRP Payment carrying an
 * encoded memo. Via Flare's FAssets "direct minting" flow and an off-chain executor,
 * that mints FXRP straight into their Flare smart account, with the memo able to
 * carry a follow-on action to execute immediately once funded.
 *
 * What is verified here, against the real @flarenetwork/smart-accounts-encoder
 * package (not docs paraphrase) and Flare's own "Direct Mint FXRP" guide:
 *   - MemoFieldUserOpCustomInstruction (opcode 0xFF) is part of the CURRENT, supported
 *     minting path, not the deprecated CollateralReservation (CRT) instructions.
 *     Flare's guide states 0xFF is used for "smart-account flows with inline memos"
 *     finalized by `executeDirectMinting`.
 *   - The instruction's input shape ({walletId, executorFeeUBA, packedUserOperation})
 *     and the PackedUserOperation ABI tuple layout (sender/nonce/initCode/callData/
 *     accountGasLimits/preVerificationGas/gasFees/paymasterAndData/signature) are both
 *     taken directly from the package's shipped .d.ts and its own README example.
 *
 * What is NOT verified, and is intentionally left as a caller-supplied parameter
 * rather than guessed: the exact ABI of the Flare smart account's own
 * `executeUserOp(Call[])` entry point (its Call{target,value,data} struct and
 * selector). Flare has not published that ABI anywhere this session could confirm on
 * a live testnet call, so this module does not fabricate it. `buildPermitCallData`
 * gives you the correctly-encoded FXRP `permit()` call to put in that Call array once
 * you have the real ABI. Guessing this rather than leaving the seam open would risk
 * producing a memo that looks valid but silently fails on-chain.
 */

import { type Hex, encodeAbiParameters, encodeFunctionData } from "viem";
import { MemoFieldUserOpCustomInstruction } from "@flarenetwork/smart-accounts-encoder";
import { PERMIT_ABI } from "./erc2612.js";

const PACKED_USER_OP_TUPLE = [
  {
    type: "tuple",
    components: [
      { name: "sender", type: "address" },
      { name: "nonce", type: "uint256" },
      { name: "initCode", type: "bytes" },
      { name: "callData", type: "bytes" },
      { name: "accountGasLimits", type: "bytes32" },
      { name: "preVerificationGas", type: "uint256" },
      { name: "gasFees", type: "bytes32" },
      { name: "paymasterAndData", type: "bytes" },
      { name: "signature", type: "bytes" },
    ],
  },
] as const;

export interface PackedUserOperationFields {
  sender: Hex;
  nonce: bigint;
  /** The batch-execute calldata, e.g. from executeUserOp(Call[]) once that ABI is confirmed. */
  callData: Hex;
  initCode?: Hex;
  accountGasLimits?: Hex;
  preVerificationGas?: bigint;
  gasFees?: Hex;
  paymasterAndData?: Hex;
  signature?: Hex;
}

const ZERO_BYTES32 = `0x${"00".repeat(32)}` as Hex;

/** ABI-encodes a PackedUserOperation. Layout verified against the package's own README. */
export function encodePackedUserOperation(fields: PackedUserOperationFields): Hex {
  return encodeAbiParameters(PACKED_USER_OP_TUPLE, [
    {
      sender: fields.sender,
      nonce: fields.nonce,
      initCode: fields.initCode ?? "0x",
      callData: fields.callData,
      accountGasLimits: fields.accountGasLimits ?? ZERO_BYTES32,
      preVerificationGas: fields.preVerificationGas ?? 0n,
      gasFees: fields.gasFees ?? ZERO_BYTES32,
      paymasterAndData: fields.paymasterAndData ?? "0x",
      signature: fields.signature ?? "0x",
    },
  ]);
}

/**
 * FXRP.permit() calldata for a smart account to approve FXRP3009's allowance the
 * instant its balance is minted: the "one permit (gasless)" step in SPEC.md's flow
 * diagram, riding the same XRPL payment that funded the account. Plug the result into
 * whichever Call{target,value,data} entry your confirmed executeUserOp ABI expects,
 * target = the FXRP token address.
 */
export function buildPermitCallData(auth: {
  owner: Hex;
  spender: Hex;
  value: bigint;
  deadline: bigint;
  v: number;
  r: Hex;
  s: Hex;
}): Hex {
  return encodeFunctionData({
    abi: PERMIT_ABI,
    functionName: "permit",
    args: [auth.owner, auth.spender, auth.value, auth.deadline, auth.v, auth.r, auth.s],
  });
}

/**
 * Builds the full XRPL Payment memo: header (walletId, executor fee) + the
 * ABI-encoded PackedUserOperation, ready to attach to an XRPL Payment transaction to
 * Flare's Core Vault address (see Flare's Direct Minting guide for that address on
 * your target network, not reproduced here since this session could not confirm it
 * against a live source).
 */
export function buildFundingMemo(opts: {
  walletId: number;
  executorFeeDrops: bigint;
  userOperation: PackedUserOperationFields;
}): Hex {
  const packedUserOperation = encodePackedUserOperation(opts.userOperation);
  return new MemoFieldUserOpCustomInstruction({
    walletId: opts.walletId,
    executorFeeUBA: opts.executorFeeDrops,
    packedUserOperation,
  }).encode() as Hex;
}
