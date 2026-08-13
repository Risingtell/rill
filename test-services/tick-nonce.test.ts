import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeTickNonce, decodeTickNonceMs } from "../shared/tick-nonce.js";

test("encodes and decodes a tick duration exactly", () => {
  for (const ms of [0, 1, 999, 3000, 120_000, 86_400_000, 2 ** 48 - 1]) {
    const nonce = encodeTickNonce(ms);
    assert.equal(nonce.length, 66, "nonce must be 32 bytes");
    assert.equal(decodeTickNonceMs(nonce), ms, `round trip failed for ${ms}ms`);
  }
});

test("nonces are unique across many encodes of the same duration", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 5000; i++) seen.add(encodeTickNonce(3000));
  assert.equal(seen.size, 5000, "192 bits of entropy should not collide in 5000 draws");
});

test("carries the Rill magic marker at bytes 24..25", () => {
  const nonce = encodeTickNonce(3000);
  assert.equal(nonce.slice(2 + 48, 2 + 52), "524c", "expected magic 0x524C");
});

test("ignores nonces this server did not issue", () => {
  // A stock x402 client mints 32 random bytes. Reading a duration out of that would
  // invent data, so decode must decline unless the magic marker is present.
  assert.equal(decodeTickNonceMs(`0x${"ab".repeat(32)}`), undefined);
  assert.equal(decodeTickNonceMs(`0x${"00".repeat(32)}`), undefined);
  assert.equal(decodeTickNonceMs(`0x${"ff".repeat(32)}`), undefined);
});

test("rejects malformed input rather than guessing", () => {
  assert.equal(decodeTickNonceMs("0x"), undefined);
  assert.equal(decodeTickNonceMs("0xdeadbeef"), undefined);
  assert.equal(decodeTickNonceMs("not hex at all"), undefined);
  assert.equal(decodeTickNonceMs(`0x${"ab".repeat(31)}`), undefined);
});

test("accepts a nonce with or without the 0x prefix", () => {
  const nonce = encodeTickNonce(4242);
  assert.equal(decodeTickNonceMs(nonce.slice(2)), 4242);
});

test("clamps out-of-range durations instead of throwing away the payment", () => {
  // A tick that somehow reported a nonsense duration must still settle: losing
  // metering precision beats dropping a payment the agent already authorized.
  assert.equal(decodeTickNonceMs(encodeTickNonce(-5)), 0);
  assert.equal(decodeTickNonceMs(encodeTickNonce(2 ** 50)), 2 ** 48 - 1);
});

test("rounds fractional milliseconds", () => {
  assert.equal(decodeTickNonceMs(encodeTickNonce(1500.6)), 1501);
});
