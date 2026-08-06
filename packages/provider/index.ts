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

  private readonly pending = new Map<string, PendingAuthorization>();
  private readonly fac: Fxrp3009Facilitator;
  private readonly shimAddress: Hex;

  constructor(opts: Fxrp3009SettlementProviderOptions) {
    const key = opts.facilitatorPrivateKey ?? process.env.RILL_FACILITATOR_KEY;
    if (!key) throw new Error("No facilitator key: set RILL_FACILITATOR_KEY to settle FXRP3009 authorizations.");

    this.fac = createFxrp3009Facilitator({ privateKey: key, chainId: opts.chainId, rpcUrl: opts.rpcUrl });
    this.network = this.fac.network;
    this.shimAddress = opts.shimAddress;
    this.facilitatorAddress = this.fac.facilitatorAddress;
  }

  /** Stash the agent's signed authorization for `sessionId`'s next tick. */
  stage(sessionId: string, auth: PendingAuthorization): void {
    this.pending.set(sessionId, auth);
  }

  async settle(quote: TickQuote): Promise<SettlementResult> {
    const auth = this.pending.get(quote.session.id);
    this.pending.delete(quote.session.id);
    if (!auth) {
      throw new Error(`no staged FXRP3009 authorization for session ${quote.session.id}, call stage() first`);
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
      extra: {},
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
      throw new Error(
        `FXRP3009 settlement failed: ${settled.errorReason ?? "unknown"} ${settled.errorMessage ?? ""}`.trim()
      );
    }

    return {
      txHash: settled.transaction,
      explorerUrl: explorerTxUrl(this.fac.chainId, settled.transaction),
      network: this.network,
    };
  }
}
