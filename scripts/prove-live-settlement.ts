/**
 * The self-verifier: proves FXRP3009 actually moves real FXRP on a live network,
 * not just in Hardhat's in-memory chain. Signs one EIP-2612 permit (session open)
 * and one EIP-3009 transferWithAuthorization (a tick), submits both, and checks the
 * payee's real FXRP balance increased by exactly the authorized amount.
 *
 * Usage: npx hardhat run scripts/prove-live-settlement.ts --network coston2
 *
 * Uses the same funded key as both payer and facilitator (gas payer) since this is a
 * one-key proof run, not the demo's zero-gas-agent architecture — that's what
 * apps/demo/agent.ts + apps/facilitator demonstrate instead, with two separate keys.
 */

import hre from "hardhat";
import { randomBytes } from "node:crypto";

const FXRP_ADDRESS: Record<114 | 14, string> = {
  114: "0x0b6A3645c240605887a5532109323A3E12273dc7",
  14: "0xAd552A648C74D49E10027AB8a618A3ad4901c5bE",
};

const PERMIT_TYPES = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};

const TRANSFER_AUTH_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
};

const PERMIT_VALUE = 1_000_000n; // 1.0 FXRP at 6 decimals
const TICK_VALUE = 100_000n; // 0.1 FXRP

async function main() {
  const shimAddress = process.env.RILL_SHIM_ADDRESS;
  if (!shimAddress) throw new Error("Set RILL_SHIM_ADDRESS to the deployed FXRP3009 address.");

  const networkName = hre.network.name;
  const chainId = networkName === "flare" ? 14 : 114;
  const fxrpAddress = FXRP_ADDRESS[chainId];

  const [signer] = await hre.ethers.getSigners();
  const payer = signer.address;
  // A fresh, unfunded address as payee, so the balance change is unambiguous.
  const payee = hre.ethers.Wallet.createRandom().address;

  console.log(`Network: ${networkName} (chainId ${chainId})`);
  console.log(`Payer/facilitator: ${payer}`);
  console.log(`Fresh payee: ${payee}`);
  console.log(`FXRP: ${fxrpAddress}`);
  console.log(`FXRP3009: ${shimAddress}\n`);

  const fxrp = await hre.ethers.getContractAt(
    ["function nonces(address) view returns (uint256)", "function permit(address,address,uint256,uint256,uint8,bytes32,bytes32)", "function balanceOf(address) view returns (uint256)"],
    fxrpAddress
  );
  const shim = await hre.ethers.getContractAt(
    [
      "function transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)",
    ],
    shimAddress
  );

  // --- Step 1: one gasless-to-sign, on-chain-submitted permit, opening the session ---
  const permitNonce = await fxrp.nonces(payer);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const network = await hre.ethers.provider.getNetwork();

  const permitDomain = { name: "FXRP", version: "1", chainId: network.chainId, verifyingContract: fxrpAddress };
  const permitSig = await signer.signTypedData(permitDomain, PERMIT_TYPES, {
    owner: payer,
    spender: shimAddress,
    value: PERMIT_VALUE,
    nonce: permitNonce,
    deadline,
  });
  const { v: pv, r: pr, s: ps } = hre.ethers.Signature.from(permitSig);

  console.log("Submitting permit...");
  const permitTx = await fxrp.permit(payer, shimAddress, PERMIT_VALUE, deadline, pv, pr, ps);
  const permitReceipt = await permitTx.wait();
  console.log(`Permit tx: ${permitReceipt.hash} (status: ${permitReceipt.status === 1 ? "success" : "FAILED"})`);

  // --- Step 2: one EIP-3009 tick, drawing on that allowance ---
  const nonce = `0x${randomBytes(32).toString("hex")}`;
  const authDomain = { name: "FXRP3009", version: "1", chainId: network.chainId, verifyingContract: shimAddress };
  const authSig = await signer.signTypedData(authDomain, TRANSFER_AUTH_TYPES, {
    from: payer,
    to: payee,
    value: TICK_VALUE,
    validAfter: 0n,
    validBefore: deadline,
    nonce,
  });
  const { v: av, r: ar, s: as } = hre.ethers.Signature.from(authSig);

  const payeeBalanceBefore: bigint = await fxrp.balanceOf(payee);

  console.log("\nSubmitting transferWithAuthorization...");
  const tickTx = await shim.transferWithAuthorization(payer, payee, TICK_VALUE, 0n, deadline, nonce, av, ar, as);
  const tickReceipt = await tickTx.wait();
  console.log(`Tick tx: ${tickReceipt.hash} (status: ${tickReceipt.status === 1 ? "success" : "FAILED"})`);

  const payeeBalanceAfter: bigint = await fxrp.balanceOf(payee);
  const moved = payeeBalanceAfter - payeeBalanceBefore;

  console.log(`\nPayee FXRP balance: ${payeeBalanceBefore} -> ${payeeBalanceAfter} (moved ${moved})`);
  if (moved !== TICK_VALUE) throw new Error(`Expected ${TICK_VALUE} to move, got ${moved}`);

  console.log("\nPROVEN: real FXRP moved payer -> fresh payee via a standard EIP-3009 authorization.");
  console.log(`Explorer: https://coston2-explorer.flare.network/tx/${tickReceipt.hash}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
