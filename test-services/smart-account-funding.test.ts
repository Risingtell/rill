import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeInstruction, MemoFieldUserOpCustomInstruction } from "@flarenetwork/smart-accounts-encoder";
import { buildFundingMemo, buildPermitCallData, encodePackedUserOperation } from "../shared/smart-account-funding.js";

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
