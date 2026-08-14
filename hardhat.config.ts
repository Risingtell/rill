import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-verify";
import "@nomicfoundation/hardhat-chai-matchers";
import "@typechain/hardhat";
import * as fs from "fs";
import "dotenv/config";

// Local throwaway signer for Coston2. Never commit this file's contents,
// generated once via `node -e` and gitignored, see .throwaway-key.local.
function loadDeployerKey(): string[] {
  const envKey = process.env.PRIVATE_KEY;
  if (envKey) return [envKey];
  const path = ".throwaway-key.local";
  if (fs.existsSync(path)) {
    return [fs.readFileSync(path, "utf8").trim()];
  }
  return [];
}

const FLARE_RPC_API_KEY = process.env.FLARE_RPC_API_KEY ?? "";
const FLARE_EXPLORER_API_KEY = process.env.FLARE_EXPLORER_API_KEY ?? "";

const COSTON2_EXPLORER_URL = process.env.COSTON2_EXPLORER_URL ?? "https://coston2-explorer.flare.network";
const FLARE_EXPLORER_URL = process.env.FLARE_EXPLORER_URL ?? "https://flare-explorer.flare.network";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.25",
    settings: {
      evmVersion: "cancun",
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    coston2: {
      url: FLARE_RPC_API_KEY
        ? `https://coston2-api-tracer.flare.network/ext/C/rpc?x-apikey=${FLARE_RPC_API_KEY}`
        : "https://coston2-api.flare.network/ext/C/rpc",
      accounts: loadDeployerKey(),
      chainId: 114,
    },
    flare: {
      url: FLARE_RPC_API_KEY
        ? `https://flare-api-tracer.flare.network/ext/C/rpc?x-apikey=${FLARE_RPC_API_KEY}`
        : "https://flare-api.flare.network/ext/C/rpc",
      accounts: loadDeployerKey(),
      chainId: 14,
    },
  },
  etherscan: {
    apiKey: {
      coston2: FLARE_EXPLORER_API_KEY,
      flare: FLARE_EXPLORER_API_KEY,
    },
    customChains: [
      {
        network: "coston2",
        chainId: 114,
        urls: {
          apiURL: `${COSTON2_EXPLORER_URL}/api` + (FLARE_EXPLORER_API_KEY ? `?x-apikey=${FLARE_EXPLORER_API_KEY}` : ""),
          browserURL: COSTON2_EXPLORER_URL,
        },
      },
      {
        network: "flare",
        chainId: 14,
        urls: {
          apiURL: `${FLARE_EXPLORER_URL}/api` + (FLARE_EXPLORER_API_KEY ? `?x-apikey=${FLARE_EXPLORER_API_KEY}` : ""),
          browserURL: FLARE_EXPLORER_URL,
        },
      },
    ],
  },
  paths: {
    sources: "./contracts/",
    tests: "./test/",
    cache: "./cache",
    artifacts: "./artifacts",
  },
};

export default config;
