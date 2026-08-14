#!/usr/bin/env node
/**
 * fxrp3009 CLI.
 *
 * Four commands, each answering a question you would otherwise have to write a script
 * for: what does this address hold, what did a provider actually settle, how long did
 * a given tick pay for, and does a zero-gas payment really work end to end.
 *
 *   fxrp3009 balance <address> [--network coston2|flare]
 *   fxrp3009 verify --payee <addr> [--shim <addr>] [--network ...]
 *   fxrp3009 decode-nonce <0x...>
 *   fxrp3009 pay <resource-url> --key <0x...> --facilitator <url> [--budget 1000000]
 */

import { formatUnits, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Fxrp3009Client } from "./client.js";
import { FXRP_ADDRESS, FXRP3009_ADDRESS, FXRP_DECIMALS, CHAINS, type FlareChainId } from "./constants.js";
import { decodeTickNonceMs } from "../../../shared/tick-nonce.js";
import { fetchChainImpact } from "../../../shared/chain-impact.js";

const argv = process.argv.slice(2);
const cmd = argv[0];

function flag(name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

function networkId(): FlareChainId {
  const n = (flag("network") ?? "coston2").toLowerCase();
  if (n === "flare" || n === "mainnet" || n === "14") return 14;
  return 114;
}

function usage(): never {
  console.log(`fxrp3009: EIP-3009 payments for Flare's FXRP

  fxrp3009 balance <address> [--network coston2|flare]
      FXRP and gas balances. A working payer holds FXRP and zero gas.

  fxrp3009 verify --payee <address> [--shim <address>] [--network ...]
      Rebuild a provider's settlement totals from the block explorer.

  fxrp3009 decode-nonce <0x...>
      Read the metered duration out of an EIP-3009 tick nonce.

  fxrp3009 pay <resource-url> --key <0x...> --facilitator <url> [--budget 1000000] [--method POST]
      Open a session and pay for a resource, spending no gas.
`);
  process.exit(cmd ? 1 : 0);
}

async function main() {
  const chainId = networkId();

  if (cmd === "balance") {
    const address = argv[1] as Hex;
    if (!address?.startsWith("0x")) usage();
    const client = new Fxrp3009Client({
      account: { address, type: "local" } as never,
      chainId,
    });
    const [fxrp, gas] = await Promise.all([client.fxrpBalance(address), client.gasBalance(address)]);
    const symbol = CHAINS[chainId].nativeCurrency.symbol;
    console.log(`address : ${address}`);
    console.log(`network : ${CHAINS[chainId].name}`);
    console.log(`FXRP    : ${formatUnits(fxrp, FXRP_DECIMALS)}`);
    console.log(`${symbol.padEnd(8)}: ${formatUnits(gas, 18)}${gas === 0n ? "   <- zero gas, as intended" : ""}`);
    return;
  }

  if (cmd === "verify") {
    const payee = flag("payee") as Hex;
    if (!payee?.startsWith("0x")) usage();
    const shim = (flag("shim") ?? FXRP3009_ADDRESS[chainId]) as Hex;
    const impact = await fetchChainImpact({
      chainId,
      payee,
      shimAddress: shim,
      fxrpAddress: FXRP_ADDRESS[chainId],
    });
    console.log(`network          : ${impact.network}`);
    console.log(`settlements      : ${impact.totals.settlements}${impact.truncated ? " (at least: more history than one read returns)" : ""}`);
    console.log(`total paid       : ${impact.totals.totalPaidFormatted} ${impact.totals.asset}`);
    console.log(`seconds streamed : ${impact.totals.secondsStreamed.toFixed(3)}`);
    console.log(`with on-chain ms : ${impact.totals.durationsOnChain} of ${impact.totals.settlements}`);
    console.log(`unique payers    : ${impact.totals.uniqueAgents}`);
    return;
  }

  if (cmd === "decode-nonce") {
    const nonce = argv[1];
    if (!nonce) usage();
    const ms = decodeTickNonceMs(nonce);
    if (ms === undefined) {
      console.log("not a Rill-issued tick nonce (no 0x524C marker), so it carries no duration");
      process.exit(1);
    }
    console.log(`${ms} ms  =  ${(ms / 1000).toFixed(3)} seconds`);
    return;
  }

  if (cmd === "pay") {
    const url = argv[1];
    const key = flag("key");
    const facilitatorUrl = flag("facilitator");
    if (!url || !key) usage();

    const account = privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as Hex);
    const client = new Fxrp3009Client({ account, chainId, facilitatorUrl });

    const gas = await client.gasBalance();
    console.log(`payer   : ${client.address}`);
    console.log(`FXRP    : ${formatUnits(await client.fxrpBalance(), FXRP_DECIMALS)}`);
    console.log(`gas     : ${formatUnits(gas, 18)} ${CHAINS[chainId].nativeCurrency.symbol}`);

    if (facilitatorUrl) {
      const budget = BigInt(flag("budget") ?? "1000000");
      const tx = await client.openSession({ budget });
      console.log(`session : permit sponsored, ${tx}`);
    }

    const res = await client.fetchPaid(url, { method: flag("method") ?? "POST" });
    console.log(`status  : ${res.status}`);
    console.log(await res.text());

    const after = await client.gasBalance();
    if (after !== gas) console.log(`WARNING: gas balance changed, the payer should never spend gas`);
    else console.log(`gas     : unchanged, the facilitator paid for every transaction`);
    return;
  }

  usage();
}

main().catch((err) => {
  console.error(`error: ${(err as Error).message}`);
  process.exit(1);
});
