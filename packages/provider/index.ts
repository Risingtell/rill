/**
 * Fxrp3009SettlementProvider — meter402's SettlementProvider, backed by the FXRP3009
 * shim (contracts/FXRP3009.sol) instead of a plain ERC-20 transfer.
 *
 * Unlike Spigot's ArcEoaSettlementProvider (agent signs AND broadcasts with its own
 * gas), the whole point of FXRP3009 is that the agent never holds a gas token. The
 * agent signs a standard EIP-3009 authorization off-chain — free — and hands it to
 * this provider, which holds the facilitator's gas-paying key and broadcasts
 * `transferWithAuthorization` on the agent's behalf. meter402's split of
 * quoteTick()/settle() has no room for a signature parameter, so `stage()` is the
 * bridge: the HTTP layer stashes the agent's per-tick authorization here right before
 * triggering the existing quoteTick -> settle -> commitTick sequence.
 *
 * verify()/settle() are @x402/evm's real ExactEvmScheme implementation, not a
 * hand-rolled check — the same code a stock x402 facilitator runs against USDC on
 * Base runs here against FXRP3009 on Flare. That is the whole thesis: SPEC.md
 * section 2.
 */

import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { x402Facilitator } from "@x402/core/facilitator";
import { registerExactEvmScheme } from "@x402/evm/exact/facilitator";
import type { FacilitatorEvmSigner } from "@x402/evm";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import type { SettlementProvider, SettlementResult, TickQuote } from "meter402";
import { coston2, flare, COSTON2_CAIP2, FLARE_CAIP2, explorerTxUrl } from "../../shared/flare-chains.js";

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

function normalizeKey(key: string): Hex {
  const trimmed = key.trim();
  return (trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`) as Hex;
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
  private readonly facilitator = new x402Facilitator();
  private readonly shimAddress: Hex;
  private readonly chainId: 114 | 14;

  constructor(opts: Fxrp3009SettlementProviderOptions) {
    const key = opts.facilitatorPrivateKey ?? process.env.RILL_FACILITATOR_KEY;
    if (!key) throw new Error("No facilitator key: set RILL_FACILITATOR_KEY to settle FXRP3009 authorizations.");

    const chain = opts.chainId === 114 ? coston2 : flare;
    const account = privateKeyToAccount(normalizeKey(key));
    const transport = http(opts.rpcUrl);
    const publicClient = createPublicClient({ chain, transport });
    const walletClient = createWalletClient({ account, chain, transport });

    this.chainId = opts.chainId;
    this.network = opts.chainId === 114 ? COSTON2_CAIP2 : FLARE_CAIP2;
    this.shimAddress = opts.shimAddress;
    this.facilitatorAddress = account.address;

    const signer: FacilitatorEvmSigner = {
      getAddresses: () => [account.address],
      readContract: (args) => publicClient.readContract(args as never),
      verifyTypedData: (args) => publicClient.verifyTypedData(args as never),
      writeContract: (args) => walletClient.writeContract({ ...args, chain, account } as never),
      sendTransaction: (args) => walletClient.sendTransaction({ ...args, chain, account } as never),
      waitForTransactionReceipt: (args) => publicClient.waitForTransactionReceipt(args),
      getCode: (args) => publicClient.getCode(args),
    };

    registerExactEvmScheme(this.facilitator, { networks: this.network as never, signer });
  }

  /** Stash the agent's signed authorization for `sessionId`'s next tick. */
  stage(sessionId: string, auth: PendingAuthorization): void {
    this.pending.set(sessionId, auth);
  }

  async settle(quote: TickQuote): Promise<SettlementResult> {
    const auth = this.pending.get(quote.session.id);
    this.pending.delete(quote.session.id);
    if (!auth) {
      throw new Error(`no staged FXRP3009 authorization for session ${quote.session.id} — call stage() first`);
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

    const verified = await this.facilitator.verify(payload, requirements);
    if (!verified.isValid) {
      throw new Error(`FXRP3009 authorization failed verification: ${verified.invalidReason ?? "unknown"}`);
    }

    const settled = await this.facilitator.settle(payload, requirements);
    if (!settled.success) {
      throw new Error(
        `FXRP3009 settlement failed: ${settled.errorReason ?? "unknown"} ${settled.errorMessage ?? ""}`.trim()
      );
    }

    return {
      txHash: settled.transaction,
      explorerUrl: explorerTxUrl(this.chainId, settled.transaction),
      network: this.network,
    };
  }
}
