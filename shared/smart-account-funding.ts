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
 *   - The `executeUserOp(Call[])` entry point, CONFIRMED ON-CHAIN 2026-08-14 rather
 *     than taken from a doc. Route: the on-chain ContractRegistry resolves
 *     `MasterAccountController` to 0x434936d47503353f06750Db1A444DBDC5F0AD37c (the
 *     same address on Coston2 and Flare mainnet). That is an EIP-2535 diamond; its
 *     `UserOperationExecuted(address indexed personalAccount, uint256 nonce)` logs
 *     name live personal accounts. One of those (0xb21BE347eb2036aD906a7352fA133b2FB73e6668)
 *     is an EIP-1967 beacon proxy onto implementation
 *     0xe900cf0C3f1320816700c669B002835aCc9A93A6, whose source is verified on the
 *     explorer as `PersonalAccount` and exposes exactly:
 *         function executeUserOp(Call[] calldata _calls) external payable;
 *         struct Call { address target; uint256 value; bytes data; }
 *     An earlier pass left this as a caller-supplied seam because it could not be
 *     confirmed. It can be, so it no longer is.
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
  /** The batch-execute calldata, normally from buildExecuteUserOpCallData(). */
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
 * The Flare smart account's batch-execute entry point, confirmed against the verified
 * `PersonalAccount` implementation on Coston2 (see the module header for the trail).
 */
export const EXECUTE_USER_OP_ABI = [
  {
    type: "function",
    name: "executeUserOp",
    stateMutability: "payable",
    inputs: [
      {
        name: "_calls",
        type: "tuple[]",
        components: [
          { name: "target", type: "address" },
          { name: "value", type: "uint256" },
          { name: "data", type: "bytes" },
        ],
      },
    ],
    outputs: [],
  },
] as const;

/** One entry in an executeUserOp batch. */
export interface SmartAccountCall {
  target: Hex;
  value?: bigint;
  data: Hex;
}

/**
 * Encode a batch of calls for the smart account to run once it is funded. This is the
 * `callData` field of the PackedUserOperation that rides inside the XRPL memo.
 */
export function buildExecuteUserOpCallData(calls: readonly SmartAccountCall[]): Hex {
  return encodeFunctionData({
    abi: EXECUTE_USER_OP_ABI,
    functionName: "executeUserOp",
    args: [calls.map((c) => ({ target: c.target, value: c.value ?? 0n, data: c.data }))],
  });
}

/**
 * FXRP.permit() calldata for a smart account to approve FXRP3009's allowance the
 * instant its balance is minted: the "one permit (gasless)" step in SPEC.md's flow
 * diagram, riding the same XRPL payment that funded the account. Pass the result to
 * buildExecuteUserOpCallData() with target = the FXRP token address.
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
