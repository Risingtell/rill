/**
 * Reads Flare's FTSOv2 XRP/USD feed to price the stream in FXRP. Addresses and feed IDs
 * verified against the published @flarenetwork/flare-periphery-contracts package
 * (coston2/ContractRegistry.sol, coston2/FtsoV2Interface.sol) rather than docs alone.
 * The registry address is constant across every Flare network; feeds resolve
 * dynamically through it because underlying FTSO contract addresses do change.
 *
 * This is what makes FTSO load-bearing rather than decorative (SPEC.md section 3):
 * the stream's ratePerSecond is a live USD/sec rate converted to FXRP at read time, not
 * a hardcoded number.
 */

import { type PublicClient, encodeAbiParameters, keccak256 } from "viem";

export const FLARE_CONTRACT_REGISTRY_ADDRESS = "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019" as const;
export const XRP_USD_FEED_ID = "0x015852502f55534400000000000000000000000000" as const;

const REGISTRY_ABI = [
  {
    type: "function",
    name: "getContractAddressByHash",
    stateMutability: "view",
    inputs: [{ name: "_nameHash", type: "bytes32" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

/** view-only on testnet (TestFtsoV2Interface); mainnet's getFeedById is payable and needs
 * FeeCalculator fee handling, which is out of scope for this Coston2 demo. */
const FTSO_V2_ABI = [
  {
    type: "function",
    name: "getFeedById",
    stateMutability: "view",
    inputs: [{ name: "_feedId", type: "bytes21" }],
    outputs: [
      { name: "_value", type: "uint256" },
      { name: "_decimals", type: "int8" },
      { name: "_timestamp", type: "uint64" },
    ],
  },
] as const;

/** keccak256(abi.encode("FtsoV2")): Solidity's string ABI-encoding, replicated in viem. */
const FTSO_V2_NAME_HASH = keccak256(encodeAbiParameters([{ type: "string" }], ["FtsoV2"]));

export interface XrpUsdPrice {
  /** XRP price in USD, scaled by 10^decimals. */
  value: bigint;
  decimals: number;
  timestamp: bigint;
}

export async function getXrpUsdPrice(publicClient: PublicClient): Promise<XrpUsdPrice> {
  const ftsoV2Address = (await publicClient.readContract({
    address: FLARE_CONTRACT_REGISTRY_ADDRESS,
    abi: REGISTRY_ABI,
    functionName: "getContractAddressByHash",
    args: [FTSO_V2_NAME_HASH],
  })) as `0x${string}`;

  const [value, decimals, timestamp] = (await publicClient.readContract({
    address: ftsoV2Address,
    abi: FTSO_V2_ABI,
    functionName: "getFeedById",
    args: [XRP_USD_FEED_ID],
  })) as [bigint, number, bigint];

  return { value, decimals, timestamp };
}

/**
 * Converts a USD-per-second rate (as a decimal string, e.g. "0.001" = $0.001/s) into
 * FXRP smallest units per second (6 decimals), using a live XRP/USD price.
 */
export function usdPerSecondToFxrpPerSecond(usdPerSecond: string, price: XrpUsdPrice): string {
  const FXRP_DECIMALS = 6n;
  const usdMicros = BigInt(Math.round(parseFloat(usdPerSecond) * 1_000_000)); // 6dp fixed-point USD
  // fxrp = usdMicros / 1e6 (undo fixed-point) / (price.value / 10^decimals) * 10^FXRP_DECIMALS
  const priceScale = 10n ** BigInt(price.decimals);
  const numerator = usdMicros * priceScale * 10n ** FXRP_DECIMALS;
  const denominator = 1_000_000n * price.value;
  return (numerator / denominator).toString();
}
