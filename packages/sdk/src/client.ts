/**
 * Fxrp3009Client: pay for x402-metered resources in FXRP while holding no gas token.
 *
 * FXRP implements EIP-2612 `permit` but none of EIP-3009, so no standard x402 client
 * can move it. The FXRP3009 shim supplies the missing half. This client is the payer
 * side of that: it signs, and it never broadcasts. Every on-chain transaction its
 * payments cause is submitted and paid for by a facilitator.
 *
 * The whole flow in one call:
 *
 *   const client = new Fxrp3009Client({ account, chainId: 114 });
 *   await client.openSession({ budget: 1_000_000n });   // one gasless permit
 *   const data = await client.fetchPaid("https://provider.example/stream");
 *
 * `fetchPaid` speaks standard x402: it takes the 402, reads the payment requirements,
 * signs an EIP-3009 authorization for exactly the quoted amount, and resubmits. A
 * server does not have to know anything about this library for it to work.
 */

import {
  createPublicClient,
  http,
  type Account,
  type Hex,
  type PublicClient,
} from "viem";
import {
  CHAINS,
  FXRP_ADDRESS,
  FXRP3009_ADDRESS,
  ERC20_ABI,
  PERMIT_TYPES,
  TRANSFER_AUTH_TYPES,
  type FlareChainId,
} from "./constants.js";

export interface Fxrp3009ClientOptions {
  /** A viem account. Only ever used to sign; this client never sends a transaction. */
  account: Account;
  /** 114 for Coston2, 14 for Flare mainnet. */
  chainId: FlareChainId;
  /** Deployed FXRP3009 shim. Defaults to the published deployment for the network. */
  shimAddress?: Hex;
  /** Facilitator that sponsors gas. Required for openSession(). */
  facilitatorUrl?: string;
  rpcUrl?: string;
}

/** A signed EIP-3009 authorization: a complete payment instruction anyone can submit. */
export interface SignedAuthorization {
  from: Hex;
  to: Hex;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: Hex;
  signature: Hex;
}

/** The x402 payment requirements a resource server returns with its 402. */
export interface PaymentRequirement {
  scheme?: string;
  network?: string;
  asset?: Hex;
  amount: string;
  payTo: Hex;
  maxTimeoutSeconds?: number;
  extra?: {
    name?: string;
    version?: string;
    nonce?: Hex;
    validAfter?: string;
    validBefore?: string;
    [key: string]: unknown;
  };
}

export class Fxrp3009Client {
  readonly address: Hex;
  readonly chainId: FlareChainId;
  readonly shimAddress: Hex;

  private readonly account: Account;
  private readonly publicClient: PublicClient;
  private readonly facilitatorUrl?: string;

  constructor(opts: Fxrp3009ClientOptions) {
    this.account = opts.account;
    this.address = opts.account.address;
    this.chainId = opts.chainId;
    this.shimAddress = opts.shimAddress ?? FXRP3009_ADDRESS[opts.chainId];
    this.facilitatorUrl = opts.facilitatorUrl?.replace(/\/+$/, "");
    this.publicClient = createPublicClient({
      chain: CHAINS[opts.chainId],
      transport: http(opts.rpcUrl),
    }) as PublicClient;
  }

  /** FXRP balance in smallest units (6 decimals). */
  async fxrpBalance(address: Hex = this.address): Promise<bigint> {
    return (await this.publicClient.readContract({
      address: FXRP_ADDRESS[this.chainId],
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [address],
    })) as bigint;
  }

  /** Native gas balance in wei. For a correctly-operating payer this stays at zero. */
  async gasBalance(address: Hex = this.address): Promise<bigint> {
    return this.publicClient.getBalance({ address });
  }

  /** How much the shim is currently allowed to move on this payer's behalf. */
  async allowance(): Promise<bigint> {
    return (await this.publicClient.readContract({
      address: FXRP_ADDRESS[this.chainId],
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [this.address, this.shimAddress],
    })) as bigint;
  }

  /**
   * Sign one EIP-2612 permit covering a session's whole budget.
   *
   * Deliberately once per session rather than once per payment: EIP-2612 nonces are
   * sequential and race under concurrency, while the EIP-3009 nonces used for each
   * subsequent tick are random and do not.
   */
  async signPermit(opts: { budget: bigint; deadlineSeconds?: number }): Promise<{
    owner: Hex;
    value: string;
    deadline: string;
    v: number;
    r: Hex;
    s: Hex;
  }> {
    const token = FXRP_ADDRESS[this.chainId];
    const nonce = (await this.publicClient.readContract({
      address: token,
      abi: ERC20_ABI,
      functionName: "nonces",
      args: [this.address],
    })) as bigint;

    const deadline = BigInt(Math.floor(Date.now() / 1000) + (opts.deadlineSeconds ?? 3600));

    const signature = await this.account.signTypedData!({
      domain: { name: "FXRP", version: "1", chainId: this.chainId, verifyingContract: token },
      types: PERMIT_TYPES,
      primaryType: "Permit",
      message: {
        owner: this.address,
        spender: this.shimAddress,
        value: opts.budget,
        nonce,
        deadline,
      },
    });

    return {
      owner: this.address,
      value: opts.budget.toString(),
      deadline: deadline.toString(),
      v: parseInt(signature.slice(130, 132), 16),
      r: `0x${signature.slice(2, 66)}` as Hex,
      s: `0x${signature.slice(66, 130)}` as Hex,
    };
  }

  /**
   * Open a session: sign the permit and have the facilitator put it on chain.
   * Returns the sponsoring transaction hash. The payer still spends no gas.
   */
  async openSession(opts: { budget: bigint; deadlineSeconds?: number }): Promise<string> {
    if (!this.facilitatorUrl) {
      throw new Error("openSession needs a facilitatorUrl to sponsor the permit on-chain");
    }
    const permit = await this.signPermit(opts);
    const res = await fetch(`${this.facilitatorUrl}/sponsor-permit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(permit),
    });
    const body = (await res.json()) as { success: boolean; transaction?: string; errorMessage?: string };
    if (!body.success) throw new Error(`permit sponsorship failed: ${body.errorMessage ?? res.status}`);
    return body.transaction!;
  }

  /**
   * Sign an EIP-3009 authorization matching a server's payment requirement.
   *
   * The EIP-712 domain comes from the requirement, not from a constant compiled in
   * here: that is what makes this a standard x402 client rather than one that only
   * talks to servers it was built against.
   */
  async signAuthorization(req: PaymentRequirement): Promise<SignedAuthorization> {
    const name = req.extra?.name;
    const version = req.extra?.version;
    if (!name || !version) {
      throw new Error("payment requirement is missing extra.name / extra.version (the asset's EIP-712 domain)");
    }

    const asset = (req.asset ?? this.shimAddress) as Hex;
    const nonce = (req.extra?.nonce ?? randomNonce()) as Hex;
    const validAfter = req.extra?.validAfter ?? "0";
    const validBefore =
      req.extra?.validBefore ?? String(Math.floor(Date.now() / 1000) + (req.maxTimeoutSeconds ?? 120));

    const signature = await this.account.signTypedData!({
      domain: { name, version, chainId: this.chainId, verifyingContract: asset },
      types: TRANSFER_AUTH_TYPES,
      primaryType: "TransferWithAuthorization",
      message: {
        from: this.address,
        to: req.payTo,
        value: BigInt(req.amount),
        validAfter: BigInt(validAfter),
        validBefore: BigInt(validBefore),
        nonce,
      },
    });

    return {
      from: this.address,
      to: req.payTo,
      value: req.amount,
      validAfter,
      validBefore,
      nonce,
      signature,
    };
  }

  /**
   * Fetch a resource, paying for it if it answers 402.
   *
   * Standard x402: read `accepts`, sign the first requirement this client can satisfy,
   * resubmit. Servers need no knowledge of this library.
   *
   * The retry keeps the caller's method, which matters more than it looks. x402's own
   * convention carries payment in the `X-PAYMENT` header precisely so a paid GET stays
   * a GET, but plenty of metered endpoints are POST-only and read the authorization
   * from the body instead. Sending the header always, and the body only when the
   * method allows one, means this works against both without the caller choosing.
   */
  async fetchPaid(url: string, init: RequestInit = {}): Promise<Response> {
    const method = (init.method ?? "GET").toUpperCase();
    const first = await fetch(url, { ...init, method });
    if (first.status !== 402) return first;

    const body = (await first.json()) as { accepts?: PaymentRequirement[]; x402Version?: number };
    const req = body.accepts?.[0];
    if (!req) throw new Error("402 response carried no payment requirements");

    const authorization = await this.signAuthorization(req);

    // Echo any server-issued token back untouched: some servers pin the exact quote
    // they issued so the settled amount cannot drift from the signed one.
    const passthrough: Record<string, unknown> = {};
    if (typeof req.extra?.quoteToken === "string") passthrough.quoteToken = req.extra.quoteToken;

    const paymentPayload = {
      x402Version: body.x402Version ?? 2,
      accepted: req,
      payload: {
        signature: authorization.signature,
        authorization: {
          from: authorization.from,
          to: authorization.to,
          value: authorization.value,
          validAfter: authorization.validAfter,
          validBefore: authorization.validBefore,
          nonce: authorization.nonce,
        },
      },
    };

    const headers: Record<string, string> = {
      ...(init.headers as Record<string, string> | undefined),
      "X-PAYMENT": Buffer.from(JSON.stringify(paymentPayload), "utf8").toString("base64"),
    };

    const bodyAllowed = method !== "GET" && method !== "HEAD";
    if (bodyAllowed) headers["Content-Type"] = "application/json";

    return fetch(url, {
      ...init,
      method,
      headers,
      body: bodyAllowed ? JSON.stringify({ ...passthrough, authorization }) : undefined,
    });
  }
}

/** A random EIP-3009 nonce, for servers that do not issue one themselves. */
export function randomNonce(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}` as Hex;
}
