/**
 * Fxrp3009SettlementProvider: meter402's SettlementProvider, backed by the FXRP3009
 * shim (contracts/FXRP3009.sol) instead of a plain ERC-20 transfer.
 *
 * Unlike Spigot's ArcEoaSettlementProvider (agent signs AND broadcasts with its own
 * gas), the whole point of FXRP3009 is that the agent never holds a gas token. The
 * agent signs a standard EIP-3009 authorization off-chain, free, and hands it to
 * this provider, which holds the facilitator's gas-paying key and broadcasts
 * `transferWithAuthorization` on the agent's behalf. meter402's split of
 * quoteTick()/settle() has no room for a signature parameter, so `stage()` is the
 * bridge: the HTTP layer stashes the agent's per-tick authorization here right before
 * triggering the existing quoteTick -> settle -> commitTick sequence.
 *
 * verify()/settle() are @x402/evm's real ExactEvmScheme implementation, not a
 * hand-rolled check. The same code a stock x402 facilitator runs against USDC on
 * Base runs here against FXRP3009 on Flare (see shared/fxrp3009-facilitator.ts).
 * That is the whole thesis: SPEC.md section 2.
 */

import type { Hex } from "viem";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import type { SettlementProvider, SettlementResult, TickQuote } from "meter402";
import { explorerTxUrl } from "../../shared/flare-chains.js";
import { createFxrp3009Facilitator, type Fxrp3009Facilitator } from "../../shared/fxrp3009-facilitator.js";

/** The agent's signed EIP-3009 authorization for one specific tick. */
export interface PendingAuthorization {
  from: Hex;
  to: Hex;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: Hex;
  signature: Hex;
}

/** ERC-5267, which OpenZeppelin's EIP712 base implements. Lets us ask the deployed
 *  shim for its own domain instead of hardcoding a copy that could drift. */
const EIP5267_ABI = [
  {
    type: "function",
    name: "eip712Domain",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "fields", type: "bytes1" },
      { name: "name", type: "string" },
      { name: "version", type: "string" },
      { name: "chainId", type: "uint256" },
      { name: "verifyingContract", type: "address" },
      { name: "salt", type: "bytes32" },
      { name: "extensions", type: "uint256[]" },
    ],
  },
] as const;

/** The EIP-712 domain an x402 `exact` payment must be signed under. */
export interface Eip712DomainInfo {
  name: string;
  version: string;
}

export interface Fxrp3009SettlementProviderOptions {
  /** Facilitator's gas-paying key. Falls back to RILL_FACILITATOR_KEY. */
  facilitatorPrivateKey?: string;
  /** 114 for Coston2, 14 for Flare mainnet. */
  chainId: 114 | 14;
  /** Deployed FXRP3009 shim address. */
  shimAddress: Hex;
  rpcUrl?: string;
}

/** True when a facilitator key is configured, so real settlement is possible. */
export function facilitatorKeyConfigured(): boolean {
  return Boolean(process.env.RILL_FACILITATOR_KEY);
}

export class Fxrp3009SettlementProvider implements SettlementProvider {
  readonly network: string;
  readonly mock = false;
  readonly facilitatorAddress: Hex;

  private readonly pending = new Map<string, { auth: PendingAuthorization; expectedNonce?: Hex }>();
  private readonly fac: Fxrp3009Facilitator;
  private readonly shimAddress: Hex;
  private domain: Eip712DomainInfo | undefined;

  constructor(opts: Fxrp3009SettlementProviderOptions) {
    const key = opts.facilitatorPrivateKey ?? process.env.RILL_FACILITATOR_KEY;
    if (!key) throw new Error("No facilitator key: set RILL_FACILITATOR_KEY to settle FXRP3009 authorizations.");

    this.fac = createFxrp3009Facilitator({ privateKey: key, chainId: opts.chainId, rpcUrl: opts.rpcUrl });
    this.network = this.fac.network;
    this.shimAddress = opts.shimAddress;
    this.facilitatorAddress = this.fac.facilitatorAddress;
  }

  /**
   * The EIP-712 domain the shim signs under, read from the contract itself via
   * ERC-5267 and cached for the process lifetime (it is immutable once deployed).
   *
   * x402's exact/EIP-3009 verifier refuses any payment whose requirements do not
   * carry `extra.name` and `extra.version`: without them it cannot rebuild the
   * digest the payer signed. Resource servers must therefore advertise the domain in
   * their 402, which is exactly what apps/demo does with this value.
   */
  async eip712Domain(): Promise<Eip712DomainInfo> {
    if (this.domain) return this.domain;
    const result = (await this.fac.signer.readContract({
      address: this.shimAddress,
      abi: EIP5267_ABI,
      functionName: "eip712Domain",
    } as never)) as readonly [Hex, string, string, bigint, Hex, Hex, readonly bigint[]];
    this.domain = { name: result[1], version: result[2] };
    return this.domain;
  }

  /**
   * Stash the agent's signed authorization for `sessionId`'s next tick.
   *
   * `expectedNonce` is the nonce the resource server put in its 402 response. Passing
   * it binds the settlement to that exact nonce: see the check in settle() for why
   * that matters.
   */
  stage(sessionId: string, auth: PendingAuthorization, expectedNonce?: Hex): void {
    this.pending.set(sessionId, { auth, expectedNonce });
  }

  async settle(quote: TickQuote): Promise<SettlementResult> {
    const staged = this.pending.get(quote.session.id);
    this.pending.delete(quote.session.id);
    if (!staged) {
      throw new Error(`no staged FXRP3009 authorization for session ${quote.session.id}, call stage() first`);
    }
    const { auth, expectedNonce } = staged;

    // The client chooses what it signs, so it could sign a nonce other than the one
    // quoted. Payee and value are checked below, so that cannot move money anywhere
    // it should not go, but the nonce is what the shim emits in AuthorizationUsed and
    // what shared/tick-nonce.ts encodes the metered duration into. Letting a client
    // pick it freely would let it write false durations into the on-chain record the
    // console reports from. Bind it.
    if (expectedNonce && auth.nonce.toLowerCase() !== expectedNonce.toLowerCase()) {
      throw new Error(`authorization nonce ${auth.nonce} does not match the nonce quoted for this tick`);
    }

    const payTo = quote.stream.payTo;
    if (!payTo) throw new Error(`stream ${quote.stream.id} has no payTo address`);
    if (auth.to.toLowerCase() !== payTo.toLowerCase()) {
      throw new Error(`authorization payee ${auth.to} does not match stream payTo ${payTo}`);
    }
    if (auth.value !== quote.amount) {
      throw new Error(`authorization value ${auth.value} does not match quoted tick amount ${quote.amount}`);
    }

    const requirements: PaymentRequirements = {
      scheme: "exact",
      network: this.network as never,
      asset: this.shimAddress,
      amount: quote.amount,
      payTo,
      maxTimeoutSeconds: 120,
      extra: { ...(await this.eip712Domain()) },
    };
    const payload: PaymentPayload = {
      x402Version: 2,
      accepted: requirements,
      payload: {
        signature: auth.signature,
        authorization: {
          from: auth.from,
          to: auth.to,
          value: auth.value,
          validAfter: auth.validAfter,
          validBefore: auth.validBefore,
          nonce: auth.nonce,
        },
      },
    };

    const verified = await this.fac.facilitator.verify(payload, requirements);
    if (!verified.isValid) {
      throw new Error(`FXRP3009 authorization failed verification: ${verified.invalidReason ?? "unknown"}`);
    }

    const settled = await this.fac.facilitator.settle(payload, requirements);
    if (!settled.success) {
      // Some failures happen after the transaction was already broadcast (x402 checks
      // the receipt's Transfer event once it lands). Carrying the hash through means a
      // failure that still moved money can be reconciled instead of disappearing.
      const landed = settled.transaction ? ` broadcastTx=${settled.transaction}` : "";
      throw new Error(
        `FXRP3009 settlement failed: ${settled.errorReason ?? "unknown"} ${settled.errorMessage ?? ""}${landed}`.trim()
      );
    }

    return {
      txHash: settled.transaction,
      explorerUrl: explorerTxUrl(this.fac.chainId, settled.transaction),
      network: this.network,
    };
  }
}
