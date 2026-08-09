# Rill

**A standard EIP-3009 authorization shim for FXRP: the one thing missing before Flare's own x402 guide can run on its flagship FAsset instead of a mock token.**

Flare Summer Signal, Track 1 (Interoperable Asset Products). Full architecture rationale, the on-chain verification behind every claim below, and the four-systems breakdown live in [`SPEC.md`](./SPEC.md).

**Live on Coston2.** `FXRP3009` is deployed at [`0xb1a5826C3Ae8afDfB724D0DBaEEbAa4841605B86`](https://coston2-explorer.flare.network/address/0xb1a5826C3Ae8afDfB724D0DBaEEbAa4841605B86). A real permit plus a real EIP-3009 authorization have already moved real FXRP to a fresh, previously-empty address, in [transaction `0xe905be786b250d1109667084448a901c769fd7abd282040d4c944b6ffb23ab90`](https://coston2-explorer.flare.network/tx/0xe905be786b250d1109667084448a901c769fd7abd282040d4c944b6ffb23ab90). Reproduce it yourself with `npx hardhat run scripts/prove-live-settlement.ts --network coston2`.

**The facilitator is live too**, at [rill-facilitator.vercel.app](https://rill-facilitator.vercel.app), speaking standard x402 `exact` against the deployed shim above.

## The gap, verified on-chain

Flare's own x402 guide ships against **MockUSDT0**, not FXRP, because FXRP doesn't implement EIP-3009's `transferWithAuthorization`. We scanned the deployed proxy on both Coston2 and mainnet directly rather than trusting the docs:

| | Coston2 | Mainnet |
|---|---|---|
| `permit` (EIP-2612) | yes | yes |
| `transferWithAuthorization` (EIP-3009) | no | no |

FXRP already has a gasless allowance mechanism (`permit`), it just doesn't speak the specific EIP-3009 shape that `x402` clients and facilitators expect. `FXRP3009.sol` is that shape, layered on top: one gasless `permit` opens a session's allowance, then every tick after that is a standard EIP-3009 authorization drawn against it. Real FXRP moves `payer -> payee` on every settlement; it's never custodied by the shim.

## What's built and verified

| Piece | Status |
|---|---|
| `contracts/FXRP3009.sol` | **12/12 tests passing**, plus **live on Coston2** with a real permit + EIP-3009 transfer proven on-chain (see above) |
| `packages/provider/Fxrp3009SettlementProvider` | meter402's `SettlementProvider` interface, backed by `@x402/evm`'s **real, unmodified** EIP-3009 "exact" scheme, not a hand-rolled check |
| `apps/facilitator` (standalone x402 facilitator) | Live HTTP-tested: `/health`, `/supported`, `/verify`, `/settle`, `/sponsor-permit`; asset-allowlisted so it can only ever settle FXRP3009 |
| `apps/demo` (metered stream + agent + console) | End-to-end tested: two-phase 402 quote/settle, live console screenshotted rendering real settlement rows |
| FTSOv2 pricing | **Live-verified against Coston2**: dynamically resolves `FtsoV2` through `ContractRegistry`, not a hardcoded address (one doc's copy of that address was silently corrupted by one character; verifying on-chain caught it), reads XRP/USD, converts a USD/sec rate to FXRP smallest units in real time |
| Smart Accounts funding memo | **3/3 tests passing**, round-tripped through Flare's own `@flarenetwork/smart-accounts-encoder` package, see honest limitations below |

## The four Flare systems, each load-bearing

- **FAssets / FXRP**: the settlement asset. `FXRP3009` exists specifically to fix its EIP-3009 gap.
- **FTSO**: live XRP/USD pricing, resolved through the real `ContractRegistry`, not hardcoded.
- **meter402**: the metering core (already proven live on Arc testnet and X Layer mainnet in sibling projects). `Fxrp3009SettlementProvider` is the new `SettlementProvider` for it.
- **Flare Smart Accounts**: the funding path. An XRPL holder sends one XRP payment with an encoded memo; see limitations below for exactly how far this goes today.

## Honest limitations

- **The demo console isn't deployed yet.** The facilitator is (see above, `/health` responds live against the real `FXRP3009` address). The console (`apps/demo`) holds open sessions and pending quotes in memory, so it needs a host that runs one persistent process (Render, Fly) rather than a serverless function that can cold-start into a fresh, empty instance mid-session. Verified end-to-end in mock-settlement mode; not yet public.
- **Smart Accounts funding is encoding-complete, not execution-complete.** `MemoFieldUserOpCustomInstruction` (opcode `0xFF`) is confirmed as part of Flare's *current* minting path, not the deprecated CollateralReservation instructions, and the memo built by `shared/smart-account-funding.ts` round-trips correctly through Flare's own encoder. What's intentionally left open: the exact ABI of the Flare smart account's own `executeUserOp(Call[])` entry point isn't published anywhere this session could confirm against a live call, so it's a caller-supplied parameter rather than a guess. Wiring it up needs that ABI confirmed against Flare's deployed contracts, or a fallback to Flare's own Smart Accounts UI to fund a session directly.
- **FTSO `getFeedById` is the testnet (`view`) signature.** Mainnet's is `payable` and needs `FeeCalculator` fee handling, out of scope for this Coston2-only demo.
- **Hardhat 2's own dependency tree carries real advisories** (`ws`, `tmp`, `lodash`, `serialize-javascript`, `adm-zip`, `uuid`), all in dev/build tooling, not in the shipped `apps/facilitator` or `apps/demo` runtime. The real fix is Hardhat 3, a breaking major version this project has not taken given how close the deployed contract is to submission. `npm audit fix` (no `--force`) is applied where it resolves safely; the rest is disclosed here rather than silently carried.

## Repository structure

```
contracts/          FXRP3009.sol, MockFXRP.sol (test double for real FXRP)
test/                Hardhat/mocha tests for the contract
shared/              chain config, FTSO pricing, ERC-2612 permit relay, Smart Accounts encoding
packages/provider/   Fxrp3009SettlementProvider for meter402
apps/facilitator/    standalone x402 facilitator HTTP service
apps/demo/           metered demo server, zero-gas agent script, live console
test-services/       node:test suite for the shared/packages/apps layer
deploy/facilitator/  package.json template for the standalone Vercel deploy of apps/facilitator
```

## Running it

```bash
npm install

# Contract + tests (Hardhat, local chain)
npm run compile
npm test

# Services layer (viem/x402/meter402 wiring)
npm run typecheck:services
npm run test:services

# Demo, mock settlement mode (no gas needed)
npx tsx apps/demo/server.ts
npx tsx apps/demo/agent.ts        # in a second terminal
# open http://localhost:8403
```

Reproduce the live Coston2 proof yourself (needs a funded key, set as `PRIVATE_KEY` or in `.throwaway-key.local`):

```bash
RILL_SHIM_ADDRESS=0xb1a5826C3Ae8afDfB724D0DBaEEbAa4841605B86 \
  npx hardhat run scripts/prove-live-settlement.ts --network coston2
```

For live Coston2 settlement through the demo app, set `RILL_FACILITATOR_KEY`, `RILL_SHIM_ADDRESS=0xb1a5826C3Ae8afDfB724D0DBaEEbAa4841605B86`, and `RILL_PAYEE_ADDRESS` before starting `apps/demo/server.ts` and `apps/facilitator/index.ts`.

## Deploying the facilitator

`apps/facilitator` is stateless (no per-session memory), which makes it Vercel-safe. `apps/demo` is not: it holds open sessions and pending quotes in memory, so it needs a host that runs one persistent process (Render, Fly) rather than serverless functions that can cold-start into a fresh, empty instance mid-session.

To deploy the facilitator to Vercel:

```bash
npm run build:facilitator          # bundles apps/facilitator into deploy/facilitator/index.js
cd deploy/facilitator
vercel link --yes --project rill-facilitator
vercel env add RILL_FACILITATOR_KEY production
vercel env add RILL_SHIM_ADDRESS production   # 0xb1a5826C3Ae8afDfB724D0DBaEEbAa4841605B86
vercel env add RILL_CHAIN_ID production       # 114
vercel deploy --prod --yes
```

## Stack

Hardhat 2 + OpenZeppelin 5 (contract), viem + `@x402/core`/`@x402/evm` (the real, standard x402 EVM "exact" scheme implementation), meter402 (streaming settlement core, already live on two other chains), Express (facilitator/demo HTTP), TypeScript throughout.
