# Judge quickstart

Everything below is verified to work verbatim from a clean clone (cold-clone review passed, 2026-08-06). Total time: under 5 minutes.

## Prerequisites

- Node.js 18+ (built and tested on v24)
- No API keys, no signup, nothing on the critical path below

## 1. Clone and install

```bash
git clone <this-repo-url>
cd rill
npm install
```

## 2. Prove the core claim: the EIP-3009 shim works

```bash
npm run compile
npm test
```

**Expected: `12 passing`.** This is the whole thesis — `contracts/FXRP3009.sol` implementing standard `TransferWithAuthorization`/`ReceiveWithAuthorization` against a permit-funded allowance, covering replay, expiry, not-yet-valid, wrong-signer, over-spend, cancel, and both authorization paths.

## 3. Prove the x402 integration is real, not hand-rolled

```bash
npm run typecheck:services
npm run test:services
```

**Expected: `3 passing`.** `packages/provider/Fxrp3009SettlementProvider` calls `@x402/evm`'s actual `registerExactEvmScheme` — the same EVM "exact" scheme implementation a stock facilitator runs against USDC — not a custom verify/settle check. See `packages/provider/index.ts`.

## 4. Run the live demo (mock settlement, no gas needed)

```bash
npx tsx apps/demo/server.ts
```

In a second terminal:

```bash
npx tsx apps/demo/agent.ts
```

Then open **http://localhost:8403** — a live console showing settlements land in real time, with a live XRP/USD price pulled from Flare's real FTSOv2 feed (`shared/ftso.ts`, resolved dynamically through `ContractRegistry`, not a hardcoded address).

**What proves this isn't scripted:** `apps/demo/agent.ts` signs a real EIP-3009 `TransferWithAuthorization` for each tick and the server settles it through the same `Fxrp3009SettlementProvider` from step 3 — this is the identical code path a live Coston2 deployment uses, just pointed at `MockSettlementProvider` instead of a funded key. Set `RILL_FACILITATOR_KEY` + `RILL_SHIM_ADDRESS` + `RILL_PAYEE_ADDRESS` to switch it to live settlement against a deployed contract.

## 5. Live deployment: real FXRP moved on Coston2

`FXRP3009` is deployed at [`0xb1a5826C3Ae8afDfB724D0DBaEEbAa4841605B86`](https://coston2-explorer.flare.network/address/0xb1a5826C3Ae8afDfB724D0DBaEEbAa4841605B86). Click through to [transaction `0xe905be786b250d1109667084448a901c769fd7abd282040d4c944b6ffb23ab90`](https://coston2-explorer.flare.network/tx/0xe905be786b250d1109667084448a901c769fd7abd282040d4c944b6ffb23ab90) to see a real EIP-3009 authorization move real FXRP to a brand-new, previously-empty address.

Reproduce it yourself with a funded key:

```bash
RILL_SHIM_ADDRESS=0xb1a5826C3Ae8afDfB724D0DBaEEbAa4841605B86 \
  npx hardhat run scripts/prove-live-settlement.ts --network coston2
```

**Expected:** two successful transactions (a permit, then a transferWithAuthorization), and a printout confirming a fresh random address's FXRP balance moved from 0 to exactly the authorized amount.

## What each verified number in the README means

| Claim | Where to check it yourself |
|---|---|
| 12/12 contract tests | `npm test`, step 2 above |
| 3/3 services tests | `npm run test:services`, step 3 above |
| Real `@x402/evm` scheme, not hand-rolled | `packages/provider/index.ts`, `registerExactEvmScheme` import |
| Live FTSO pricing | `shared/ftso.ts` — run the demo (step 4) and watch the XRP/USD figure update |
| Real FXRP moved on Coston2 | Step 5 above, or the explorer link directly |
| Smart Accounts memo encoding | `shared/smart-account-funding.ts` + its test in `test-services/` |
