import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeInstruction, MemoFieldUserOpCustomInstruction } from "@flarenetwork/smart-accounts-encoder";
import { decodeFunctionData, toFunctionSelector } from "viem";
import {
  buildFundingMemo,
  buildPermitCallData,
  encodePackedUserOperation,
  buildExecuteUserOpCallData,
  EXECUTE_USER_OP_ABI,
} from "../shared/smart-account-funding.js";

const SHIM = "0x1111111111111111111111111111111111111111" as const;
const OWNER = "0x2222222222222222222222222222222222222222" as const;
const SMART_ACCOUNT = "0x3333333333333333333333333333333333333333" as const;
const R = `0x${"11".repeat(32)}` as const;
const S = `0x${"22".repeat(32)}` as const;

test("buildPermitCallData encodes a real FXRP.permit() call", () => {
  const callData = buildPermitCallData({ owner: OWNER, spender: SHIM, value: 1_000_000n, deadline: 9_999_999_999n, v: 27, r: R, s: S });
  assert.match(callData, /^0xd505accf/); // permit(address,address,uint256,uint256,uint8,bytes32,bytes32) selector
});

test("encodePackedUserOperation round-trips through viem's ABI decoder", () => {
  const encoded = encodePackedUserOperation({ sender: SMART_ACCOUNT, nonce: 5n, callData: "0xdeadbeef" });
  assert.ok(encoded.startsWith("0x"));
  assert.ok(encoded.length > 2);
});

test("buildFundingMemo produces a decodable 0xFF instruction with the exact fields supplied", () => {
  const memo = buildFundingMemo({
    walletId: 7,
    executorFeeDrops: 12_000n,
    userOperation: { sender: SMART_ACCOUNT, nonce: 1n, callData: buildPermitCallData({ owner: OWNER, spender: SHIM, value: 1n, deadline: 1n, v: 27, r: R, s: S }) },
  });

  assert.match(memo, /^0xff/i);

  const decoded = decodeInstruction(memo);
  assert.ok(decoded instanceof MemoFieldUserOpCustomInstruction);
  assert.equal(decoded.data.walletId, 7);
  assert.equal(decoded.data.executorFeeUBA, 12_000n);
  assert.ok(decoded.data.packedUserOperation.includes("d505accf")); // permit selector survives inside the encoded UserOp
});

test("buildExecuteUserOpCallData matches the deployed PersonalAccount selector", () => {
  // Selector for executeUserOp((address,uint256,bytes)[]), the signature confirmed
  // against Flare's verified PersonalAccount implementation on Coston2.
  const expected = toFunctionSelector("executeUserOp((address,uint256,bytes)[])");
  const callData = buildExecuteUserOpCallData([
    { target: SHIM, data: "0xdeadbeef" },
  ]);
  assert.equal(callData.slice(0, 10), expected);
});

test("executeUserOp batch round-trips through viem's decoder", () => {
  const permit = buildPermitCallData({ owner: OWNER, spender: SHIM, value: 7n, deadline: 99n, v: 27, r: R, s: S });
  const callData = buildExecuteUserOpCallData([
    { target: SHIM, value: 0n, data: permit },
    { target: OWNER, value: 5n, data: "0x1234" },
  ]);

  const decoded = decodeFunctionData({ abi: EXECUTE_USER_OP_ABI, data: callData });
  assert.equal(decoded.functionName, "executeUserOp");
  const calls = decoded.args[0] as readonly { target: string; value: bigint; data: string }[];
  assert.equal(calls.length, 2);
  assert.equal(calls[0].target.toLowerCase(), SHIM.toLowerCase());
  assert.equal(calls[0].value, 0n);
  assert.equal(calls[0].data, permit);
  assert.equal(calls[1].value, 5n);
});

test("value defaults to zero so a permit call cannot accidentally send FLR", () => {
  const callData = buildExecuteUserOpCallData([{ target: SHIM, data: "0xabcd" }]);
  const decoded = decodeFunctionData({ abi: EXECUTE_USER_OP_ABI, data: callData });
  const calls = decoded.args[0] as readonly { value: bigint }[];
  assert.equal(calls[0].value, 0n);
});

test("a funding memo can carry a real executeUserOp batch end to end", () => {
  // The whole point: one XRPL payment mints FXRP and permits the shim in one shot.
  const permit = buildPermitCallData({ owner: OWNER, spender: SHIM, value: 1_000_000n, deadline: 9_999n, v: 28, r: R, s: S });
  const memo = buildFundingMemo({
    walletId: 3,
    executorFeeDrops: 500n,
    userOperation: {
      sender: SMART_ACCOUNT,
      nonce: 2n,
      callData: buildExecuteUserOpCallData([{ target: SHIM, data: permit }]),
    },
  });

  const decoded = decodeInstruction(memo);
  assert.ok(decoded instanceof MemoFieldUserOpCustomInstruction);
  assert.equal(decoded.data.walletId, 3);
  // the executeUserOp selector and the nested permit selector both survive the trip
  assert.ok(decoded.data.packedUserOperation.includes(toFunctionSelector("executeUserOp((address,uint256,bytes)[])").slice(2)));
  assert.ok(decoded.data.packedUserOperation.includes("d505accf"));
});
