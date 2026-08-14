/**
 * One command that prints every number this project claims, freshly measured.
 *
 * Judge-facing docs used to hardcode figures like "15/15 tests" and "20 settlements"
 * in three separate files. Numbers written down in three places drift, and a stale
 * count discredits the true claims next to it. So the docs point here instead, and
 * this reads the counts from the test runners and the settlement totals from Coston2.
 *
 * Usage: npm run verify
 * Add --offline to skip the chain reads.
 */

import { execSync } from "node:child_process";
import { fetchChainImpact } from "../shared/chain-impact.js";
import { FXRP_ADDRESS, coston2 } from "../shared/flare-chains.js";
import type { Hex } from "viem";

const OFFLINE = process.argv.includes("--offline");

const SHIM = (process.env.RILL_SHIM_ADDRESS ?? "0xf073D2f6cf681cc0E3a4d391f661a994Bd32aCFa") as Hex;
const PAYEE = (process.env.RILL_PAYEE_ADDRESS ?? "0xD7Ed634428b091eb8ead65c363D0648AC3D27051") as Hex;
const AGENT = (process.env.RILL_AGENT_ADDRESS ?? "0xBDF3866Bb0c6499d8c1dD0a4c46c0b4E6cBb3E28") as Hex;
const DEMO_URL = process.env.RILL_DEMO_URL ?? "https://rill-demo.vercel.app";
const FACILITATOR_URL = process.env.RILL_FACILITATOR_URL ?? "https://rill-facilitator.vercel.app";

/**
 * Run a command and return its output, whether it exited clean or not: a failing test
 * run still has the counts we want to report.
 *
 * A single command string rather than an args array on purpose. Node deprecates
 * passing an args array alongside `shell: true` (DEP0190), but a shell is needed on
 * Windows to launch npx at all, and the test runner wants to expand the glob itself.
 */
function run(command: string): string {
  try {
    return execSync(command, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    return `${e.stdout ?? ""}${e.stderr ?? ""}`;
  }
}

function section(title: string) {
  console.log(`\n${title}`);
  console.log("-".repeat(title.length));
}

section("Tests");

const hardhat = run("npx hardhat test");
const contractTests = hardhat.match(/(\d+) passing/);
console.log(`contract tests   : ${contractTests ? `${contractTests[1]} passing` : "COULD NOT PARSE, run npm test"}`);

const services = run("npx tsx --test test-services/*.test.ts");
const pass = services.match(/^.\s*pass (\d+)$/m);
const fail = services.match(/^.\s*fail (\d+)$/m);
console.log(`service tests    : ${pass ? `${pass[1]} passing` : "COULD NOT PARSE"}${fail && fail[1] !== "0" ? `, ${fail[1]} FAILING` : ""}`);

if (OFFLINE) {
  console.log("\n(--offline: skipped chain and deployment checks)");
  process.exit(0);
}

section("Live services");

for (const [label, url] of [["demo console", DEMO_URL], ["facilitator", FACILITATOR_URL]] as const) {
  try {
    let res = await fetch(`${url}/health`);
    // Fall back to the root for any service without a health route, so a 404 here
    // does not get reported as the service being down.
    if (!res.ok) res = await fetch(url);
    console.log(`${label.padEnd(16)} : ${res.ok ? "up" : `HTTP ${res.status}`}  ${url}`);
  } catch (err) {
    console.log(`${label.padEnd(16)} : UNREACHABLE (${(err as Error).message})`);
  }
}

section("On-chain settlements (Coston2)");

try {
  const impact = await fetchChainImpact({
    chainId: 114,
    payee: PAYEE,
    shimAddress: SHIM,
    fxrpAddress: FXRP_ADDRESS[114],
  });
  console.log(`settlements      : ${impact.totals.settlements}`);
  console.log(`total paid       : ${impact.totals.totalPaidFormatted} ${impact.totals.asset}`);
  console.log(`seconds streamed : ${impact.totals.secondsStreamed.toFixed(3)}`);
  console.log(`durations on-chain: ${impact.totals.durationsOnChain} of ${impact.totals.settlements}`);
  console.log(`unique agents    : ${impact.totals.uniqueAgents}`);
} catch (err) {
  console.log(`COULD NOT READ: ${(err as Error).message}`);
}

section("Zero-gas claim");

try {
  const { createPublicClient, http, formatEther, formatUnits } = await import("viem");
  const client = createPublicClient({ chain: coston2, transport: http() });
  const [native, token] = await Promise.all([
    client.getBalance({ address: AGENT }),
    client.readContract({
      address: FXRP_ADDRESS[114],
      abi: [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }] as const,
      functionName: "balanceOf",
      args: [AGENT],
    }),
  ]);
  console.log(`agent ${AGENT}`);
  console.log(`  C2FLR (gas)    : ${formatEther(native)}   <- must be 0`);
  console.log(`  FXRP           : ${formatUnits(token, 6)}`);
  if (native !== 0n) console.log("  WARNING: the agent holds gas, which weakens the zero-gas claim");
} catch (err) {
  console.log(`COULD NOT READ: ${(err as Error).message}`);
}

console.log("");
