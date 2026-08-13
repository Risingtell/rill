/**
 * Tick nonces: carrying per-second metering data on-chain for free.
 *
 * EIP-3009 requires each authorization to carry a unique bytes32 nonce, and the
 * FXRP3009 shim emits it in `AuthorizationUsed(address indexed authorizer, bytes32
 * indexed nonce)`. The standard says nothing about how that nonce is chosen beyond
 * uniqueness, so the 32 bytes are ours to structure.
 *
 * Rill spends the low 8 bytes on the one number the chain would otherwise never see:
 * how many milliseconds of stream the tick paid for. That makes the console's
 * per-second claims auditable by anyone with a block explorer and no access to our
 * server, and it costs nothing extra, because the nonce is already emitted as an
 * indexed topic whether we fill it with randomness or with meaning.
 *
 * Layout:
 *   bytes 0..23   192 bits of randomness (uniqueness)
 *   bytes 24..25  magic 0x524C ("RL"), marks the nonce as Rill-issued
 *   bytes 26..31  uint48 big-endian duration in milliseconds
 *
 * 192 bits of entropy is far past any collision concern, and the magic prefix keeps
 * decode() from reading meaning into a nonce that some other client minted randomly.
 */

import { randomBytes } from "node:crypto";
import type { Hex } from "viem";

/** Marks a nonce as Rill-issued so decode() will not misread a random one. */
const MAGIC = 0x524c;
const MAGIC_OFFSET = 24;
const DURATION_OFFSET = 26;
/** uint48 ceiling: ~8900 years in ms, so the field can never be the limiting factor. */
const MAX_DURATION_MS = 2 ** 48 - 1;

/**
 * Build a tick nonce that encodes `durationMs`.
 *
 * Durations are clamped rather than rejected: a nonce that fails to encode would fail
 * the whole tick, and losing metering precision on an absurd input is strictly better
 * than dropping a payment the agent already agreed to.
 */
export function encodeTickNonce(durationMs: number): Hex {
  const ms = Math.max(0, Math.min(MAX_DURATION_MS, Math.round(durationMs)));
  const buf = Buffer.alloc(32);
  randomBytes(24).copy(buf, 0);
  buf.writeUInt16BE(MAGIC, MAGIC_OFFSET);
  buf.writeUIntBE(ms, DURATION_OFFSET, 6);
  return `0x${buf.toString("hex")}` as Hex;
}

/**
 * Read the metered duration back out of a nonce.
 *
 * Returns undefined for anything not carrying the magic prefix, which is the normal
 * answer for nonces minted by a stock x402 client rather than by this server. Callers
 * treat that as "duration unknown" and fall back to deriving seconds from the amount.
 */
export function decodeTickNonceMs(nonce: string): number | undefined {
  const hex = nonce.startsWith("0x") ? nonce.slice(2) : nonce;
  if (hex.length !== 64) return undefined;

  const buf = Buffer.from(hex, "hex");
  if (buf.length !== 32) return undefined;
  if (buf.readUInt16BE(MAGIC_OFFSET) !== MAGIC) return undefined;

  return buf.readUIntBE(DURATION_OFFSET, 6);
}
