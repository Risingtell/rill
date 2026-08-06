/**
 * Deploys FXRP3009 to whichever network Hardhat is pointed at, and prints the exact
 * env vars apps/facilitator and apps/demo need to go live against it.
 *
 * Usage: npx hardhat run scripts/deploy.ts --network coston2
 */

import hre from "hardhat";

// Duplicated from shared/flare-chains.ts rather than imported: this script runs under
// Hardhat's CommonJS ts-node context, shared/ is ESM (see shared/package.json), and the
// two module systems can't require() each other. Addresses verified on-chain, SPEC.md §1.
const FXRP_ADDRESS: Record<114 | 14, string> = {
  114: "0x0b6A3645c240605887a5532109323A3E12273dc7",
  14: "0xAd552A648C74D49E10027AB8a618A3ad4901c5bE",
};

async function main() {
  const networkName = hre.network.name;
  const chainId = networkName === "flare" ? 14 : 114;
  const fxrpAddress = FXRP_ADDRESS[chainId];

  const [deployer] = await hre.ethers.getSigners();
  console.log(`Deploying FXRP3009 to ${networkName} (chainId ${chainId}) from ${deployer.address}`);
  console.log(`Wrapping FXRP at ${fxrpAddress}`);

  const FXRP3009 = await hre.ethers.getContractFactory("FXRP3009");
  const shim = await FXRP3009.deploy(fxrpAddress);
  await shim.waitForDeployment();

  const shimAddress = await shim.getAddress();
  const deployTx = shim.deploymentTransaction();

  console.log(`\nFXRP3009 deployed: ${shimAddress}`);
  console.log(`Deployment tx: ${deployTx?.hash}`);
  console.log(`\nSet these before starting apps/facilitator and apps/demo:`);
  console.log(`  RILL_CHAIN_ID=${chainId}`);
  console.log(`  RILL_SHIM_ADDRESS=${shimAddress}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
