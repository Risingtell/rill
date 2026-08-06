/**
 * Standalone Rill facilitator server. Deployable on its own (Render/Vercel, see
 * SPEC.md section 6, no ngrok) so any x402 client or resource server, not just
 * apps/demo, can settle FXRP3009 authorizations against it.
 */

import "dotenv/config";
import express from "express";
import cors from "cors";
import { createFacilitatorRouter, facilitatorOptionsFromEnv } from "./router.js";

const app = express();
app.use(cors());
app.use(express.json());

const { router, fac } = createFacilitatorRouter(facilitatorOptionsFromEnv());
app.use("/", router);

const port = parseInt(process.env.PORT || "8402", 10);
app.listen(port, () => {
  console.log(`[facilitator] listening on :${port}`);
  console.log(`[facilitator] network=${fac.network} feePayer=${fac.facilitatorAddress}`);
});
