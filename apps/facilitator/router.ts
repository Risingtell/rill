/**
 * Rill's self-hosted x402 facilitator, as a mountable Express router.
 *
 * Verification and settlement are @x402/evm's real `registerExactEvmScheme` — the same
 * exact/EIP-3009 scheme implementation a stock facilitator runs against USDC on Base,
 * pointed at FXRP3009 on Flare instead. This file is only the HTTP surface plus the
 * safety rails a facilitator that spends real gas needs: an asset allowlist (so it can
 * only ever settle FXRP3009, never an arbitrary token an attacker names in
 * paymentRequirements) and an optional shared-secret gate. Modeled on Sluice's
 * facilitator/src/router.ts, which exists for the same reason on Casper.
 */

import { Router, type Request, type Response } from "express";
import { createFxrp3009Facilitator, type Fxrp3009Facilitator } from "../../shared/fxrp3009-facilitator.js";

export interface FacilitatorRouterOptions {
  /** Facilitator's gas-paying key. */
  privateKey: string;
  /** 114 for Coston2, 14 for Flare mainnet. */
  chainId: 114 | 14;
  rpcUrl?: string;
  /** The deployed FXRP3009 shim address this facilitator will settle against. */
  shimAddress: string;
  /** Shared secret required on every route except /health. Empty disables the gate. */
  secret?: string;
  /** Only settle payments to these addresses. Empty allows any. */
  allowedPayees?: Set<string>;
}

const lower = (s: string) => s.trim().toLowerCase();

interface Requirements {
  asset?: string;
  payTo?: string;
  network?: string;
}

export function createFacilitatorRouter(opts: FacilitatorRouterOptions): { router: Router; fac: Fxrp3009Facilitator } {
  const fac = createFxrp3009Facilitator({ privateKey: opts.privateKey, chainId: opts.chainId, rpcUrl: opts.rpcUrl });
  const shimAddress = lower(opts.shimAddress);
  const allowedPayees = opts.allowedPayees ?? new Set<string>();

  /** Refuse anything outside FXRP3009 / the payee allowlist, before it can spend gas. */
  const screen = (requirements: Requirements | undefined): string | undefined => {
    if (!requirements) return "missing paymentRequirements";
    const asset = lower(String(requirements.asset || ""));
    const payTo = lower(String(requirements.payTo || ""));
    if (asset !== shimAddress) {
      return `asset ${asset || "(empty)"} is not the FXRP3009 shim this facilitator serves`;
    }
    if (allowedPayees.size && !allowedPayees.has(payTo)) {
      return `payee ${payTo.slice(0, 16)} is not on this facilitator's allowlist`;
    }
    return undefined;
  };

  const router = Router();

  router.get("/health", (_req, res) => {
    res.json({ status: "ok", network: fac.network, facilitatorAddress: fac.facilitatorAddress, shimAddress: opts.shimAddress });
  });

  router.use((req: Request, res: Response, next) => {
    if (!opts.secret) return next();
    const sent = String(req.header("authorization") || "").replace(/^Bearer\s+/i, "");
    if (sent !== opts.secret) return res.status(401).json({ error: "unauthorized" });
    next();
  });

  router.get("/supported", (_req, res) => {
    res.json(fac.facilitator.getSupported());
  });

  router.post("/verify", async (req: Request, res: Response) => {
    try {
      const { paymentPayload, paymentRequirements } = req.body ?? {};
      const refused = screen(paymentRequirements);
      if (refused) return res.json({ isValid: false, invalidReason: "unsupported_scheme", errorMessage: refused });
      res.json(await fac.facilitator.verify(paymentPayload, paymentRequirements));
    } catch (err) {
      res.status(400).json({
        isValid: false,
        invalidReason: "unexpected_verify_error",
        errorMessage: (err as Error).message,
      });
    }
  });

  router.post("/settle", async (req: Request, res: Response) => {
    const { paymentPayload, paymentRequirements } = req.body ?? {};
    try {
      const refused = screen(paymentRequirements);
      if (refused) {
        return res.json({
          success: false,
          errorReason: "refused_by_allowlist",
          errorMessage: refused,
          transaction: "",
          network: paymentRequirements?.network ?? fac.network,
        });
      }
      const result = await fac.facilitator.settle(paymentPayload, paymentRequirements);
      if (!result.success) {
        console.error(`[facilitator] settle failed: ${result.errorReason} ${result.errorMessage ?? ""}`);
      }
      res.json(result);
    } catch (err) {
      res.status(400).json({
        success: false,
        errorReason: "unexpected_settle_error",
        errorMessage: (err as Error).message,
        transaction: "",
        network: paymentRequirements?.network ?? fac.network,
      });
    }
  });

  return { router, fac };
}

/** Build router options from environment, shared by standalone and mounted use. */
export function facilitatorOptionsFromEnv(): FacilitatorRouterOptions {
  const chainId = (parseInt(process.env.RILL_CHAIN_ID || "114", 10) as 114 | 14) === 14 ? 14 : 114;
  const allowedPayees = new Set(
    (process.env.FACILITATOR_ALLOWED_PAYEES || "")
      .split(",")
      .map(lower)
      .filter(Boolean)
  );

  const key = process.env.RILL_FACILITATOR_KEY;
  if (!key) throw new Error("RILL_FACILITATOR_KEY is required to run the facilitator.");
  const shimAddress = process.env.RILL_SHIM_ADDRESS;
  if (!shimAddress) throw new Error("RILL_SHIM_ADDRESS is required: the deployed FXRP3009 contract address.");

  return {
    privateKey: key,
    chainId,
    rpcUrl: process.env.RILL_RPC_URL,
    shimAddress,
    secret: process.env.FACILITATOR_SHARED_SECRET || "",
    allowedPayees,
  };
}
