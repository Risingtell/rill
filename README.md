# Rill

**A standard EIP-3009 authorization shim for FXRP: the one thing missing before Flare's own x402 guide can run on its flagship FAsset instead of a mock token.**

Flare Summer Signal, Track 1 (Interoperable Asset Products). Full architecture rationale, the on-chain verification behind every claim below, and the four-systems breakdown live in [`SPEC.md`](./SPEC.md).

## Live right now

| | |
|---|---|
| **Demo console** | **[rill-demo.vercel.app](https://rill-demo.vercel.app)** |
| **Facilitator** | [rill-facilitator.vercel.app](https://rill-facilitator.vercel.app) |
| **FXRP3009 contract** | [`0xf073D2f6cf681cc0E3a4d391f661a994Bd32aCFa`](https://coston2-explorer.flare.network/address/0xf073D2f6cf681cc0E3a4d391f661a994Bd32aCFa#code) (source verified on the explorer) |
| **Provider receiving payments** | [`0xD7Ed634428b091eb8ead65c363D0648AC3D27051`](https://coston2-explorer.flare.network/address/0xD7Ed634428b091eb8ead65c363D0648AC3D27051?tab=token_transfers) |
| **Zero-gas agents that pay** | [`0xBDF3866B...`](https://coston2-explorer.flare.network/address/0xBDF3866Bb0c6499d8c1dD0a4c46c0b4E6cBb3E28), [`0x4340c607...`](https://coston2-explorer.flare.network/address/0x4340c607BE4764C8872477381Ee2dbF6EAf58599), [`0x935BBD6a...`](https://coston2-explorer.flare.network/address/0x935BBD6a504653fD9165cc9b5b8bA6B7141f7aF6) |

Open the console and every number on it was read back from Coston2, not from the server's memory. Then check any agent address: each holds FXRP and **exactly zero C2FLR**, and each has still paid for every second of stream it consumed. That is the property the whole project exists to demonstrate.

Run `npm run verify` to re-measure all of it yourself in one command: test counts, whether both services are up, the on-chain settlement totals, and the agent's gas balance. Nothing in this README is a number typed in by hand.

## The gap, verified on-chain

Flare's own x402 guide ships against **MockUSDT0**, not FXRP, because FXRP doesn't implement EIP-3009's `transferWithAuthorization`. We scanned the deployed proxy on both Coston2 and mainnet directly rather than trusting the docs:

| | Coston2 | Mainnet |
|---|---|---|
| `permit` (EIP-2612) | yes | yes |
| `transferWithAuthorization` (EIP-3009) | no | no |

FXRP already has a gasless allowance mechanism (`permit`), it just doesn't speak the specific EIP-3009 shape that `x402` clients and facilitators expect. `FXRP3009.sol` is that shape, layered on top: one gasless `permit` opens a session's allowance, then every tick after that is a standard EIP-3009 authorization drawn against it. Real FXRP moves `payer -> payee` on every settlement; it's never custodied by the shim.

## Three things here that are not obvious

**1. The metered duration is written on-chain, for free.** EIP-3009 needs a unique `bytes32` nonce per authorization, and the shim emits it in `AuthorizationUsed`. Rill spends the low 6 bytes of that nonce on the number the chain would otherwise never see: how many milliseconds of stream the tick paid for (see [`shared/tick-nonce.ts`](./shared/tick-nonce.ts)). It costs no extra gas, because the nonce is already an indexed topic. The result is that "127 seconds streamed" is not a claim from our database, it is a figure anyone can recompute from block explorer data alone.

**2. The console reads the chain, not itself.** [`shared/chain-impact.ts`](./shared/chain-impact.ts) rebuilds the whole settlement feed from two explorer queries joined on transaction hash: FXRP transfers into the provider address, and the shim's own `AuthorizationUsed` logs. Nothing is served from process memory, so the numbers survive cold starts, redeploys and the week between submission and judging. A plain transfer sent to the same address is ignored, because without a matching authorization log it was not a metered settlement.

**3. Session state travels with the client, signed.** Serverless instances do not share memory, so an in-memory session map means a session opened by one request is missing from the next. Instead the session and each quote are HMAC-signed tokens the client carries ([`shared/session-token.ts`](./shared/session-token.ts)). Replaying a stale session token only ever bills *more* elapsed time, and a quote can only be settled once because doing so consumes its on-chain nonce. The chain enforces single use, so the server does not have to remember anything.

## What's built and verified

| Piece | Status |
|---|---|
| `contracts/FXRP3009.sol` | Deployed and **source-verified** on Coston2, with real permit + EIP-3009 settlements proven on-chain. Test count via `npm test` |
| `packages/provider/Fxrp3009SettlementProvider` | meter402's `SettlementProvider`, backed by `@x402/evm`'s **real, unmodified** EIP-3009 "exact" scheme, not a hand-rolled check |
| `apps/facilitator` (standalone x402 facilitator) | Live: `/health`, `/supported`, `/verify`, `/settle`, `/sponsor-permit`; asset-allowlisted so it can only ever settle FXRP3009 |
| `apps/demo` (metered stream + agent + console) | **Live and public**, running real settlements end to end against Coston2 |
| `shared/` services layer | Unit tests plus integration tests driving the real HTTP surface (`npm run test:services`) |
| FTSOv2 pricing | **Live-verified against Coston2**: resolves `FtsoV2` through `ContractRegistry`, not a hardcoded address (one doc's copy of that address was silently corrupted by one character; verifying on-chain caught it) |
| Smart Accounts funding | Round-tripped through Flare's own `@flarenetwork/smart-accounts-encoder`, with the `executeUserOp` entry point **confirmed against Flare's verified `PersonalAccount` contract on-chain** |

## The four Flare systems, each load-bearing

- **FAssets / FXRP**: the settlement asset. `FXRP3009` exists specifically to fix its EIP-3009 gap.
- **FTSO**: live XRP/USD pricing, resolved through the real `ContractRegistry`, not hardcoded.
- **meter402**: the metering core (already proven live on Arc testnet and X Layer mainnet in sibling projects). `Fxrp3009SettlementProvider` is the new `SettlementProvider` for it.
- **Flare Smart Accounts**: the funding path. An XRPL holder sends one XRP payment with an encoded memo; see limitations below for exactly how far this goes today.

## Honest limitations

- **The shim emits its own `Transfer` event.** A standard x402 facilitator confirms settlement by scanning the receipt for an ERC-20 `Transfer` emitted by the asset address it was handed. The real movement is emitted by FXRP, not by the shim, so without a mirrored event a perfectly valid payment is rejected as `invalid_exact_evm_transfer_event_mismatch`. The shim therefore re-emits the same movement. It is a log only: it mints nothing, custodies nothing, and every balance still lives in the FXRP contract. This is a deliberate trade to keep unmodified x402 facilitators working, and it is worth knowing that a block explorer may index the shim as if it were a token.
- **Smart Accounts funding is built and encoded, but not exercised against a live XRPL payment.** Every piece is confirmed rather than assumed: opcode `0xFF` is part of Flare's current minting path, the memo round-trips through Flare's own encoder, and `executeUserOp(Call[])` with `Call{target,value,data}` was read off Flare's verified `PersonalAccount` implementation on Coston2 (resolved from the on-chain ContractRegistry, see the trail in `shared/smart-account-funding.ts`). What has not happened is an actual XRP payment on XRPL testnet driving a mint end to end, which needs a funded XRPL account and Flare's Core Vault address for the target network.
- **Coston2 testnet only.** The contract is unaudited and the keys behind the live demo are throwaway testnet keys. Nothing here should hold value.
- **FTSO `getFeedById` is the testnet (`view`) signature.** Mainnet's is `payable` and needs `FeeCalculator` fee handling, out of scope for this Coston2-only demo.
- **Hardhat 2's own dependency tree carries real advisories**, all in dev/build tooling, not in the shipped `apps/facilitator` or `apps/demo` runtime. Traced individually in [`SECURITY.md`](./SECURITY.md) rather than waved away by severity label. The real fix is Hardhat 3, a breaking major version this project has not taken this close to submission.

## Repository structure

```
contracts/           FXRP3009.sol, MockFXRP.sol (test double for real FXRP)
test/                Hardhat/mocha tests for the contract
shared/              chain config, FTSO pricing, tick nonces, chain-derived impact,
                     session tokens, ERC-2612 permit relay, Smart Accounts encoding
packages/provider/   Fxrp3009SettlementProvider for meter402
apps/facilitator/    standalone x402 facilitator HTTP service
apps/demo/           metered demo server, zero-gas agent script, live console
test-services/       node:test suite for the shared/packages/apps layer
deploy/              package.json + build templates for the Vercel deploys
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

# Demo, mock settlement mode (no keys, no gas needed)
npx tsx apps/demo/server.ts
npx tsx apps/demo/agent.ts        # in a second terminal
# open http://localhost:8403
```

### Point the agent at the live deployment

```bash
RILL_DEMO_URL=https://rill-demo.vercel.app \
RILL_FACILITATOR_URL=https://rill-facilitator.vercel.app \
RILL_CHAIN_ID=114 \
RILL_SHIM_ADDRESS=0xf073D2f6cf681cc0E3a4d391f661a994Bd32aCFa \
RILL_AGENT_KEY=<a key holding FXRP and no C2FLR> \
  npx tsx apps/demo/agent.ts
```

### Reproduce the on-chain proof directly

Needs a funded key, set as `PRIVATE_KEY` or in `.throwaway-key.local`:

```bash
RILL_SHIM_ADDRESS=0xf073D2f6cf681cc0E3a4d391f661a994Bd32aCFa \
  npx hardhat run scripts/prove-live-settlement.ts --network coston2
```

## Deploying

Both services are stateless, so both run on Vercel. `apps/demo` gets there by keeping session state in signed client-held tokens and reading its console figures from the chain, rather than by holding anything in process memory.

```bash
npm run build:facilitator          # or: npm run build:demo
cd deploy/facilitator              # or: cd deploy/demo
vercel link --yes --project rill-facilitator
vercel env add RILL_FACILITATOR_KEY production
vercel env add RILL_SHIM_ADDRESS production   # 0xf073D2f6cf681cc0E3a4d391f661a994Bd32aCFa
vercel env add RILL_CHAIN_ID production       # 114
# apps/demo additionally needs RILL_PAYEE_ADDRESS and RILL_USD_PER_SECOND
vercel deploy --prod --yes
```

Pipe env values in without a trailing newline (`printf '114' | vercel env add ...`). A shell that appends a BOM or a newline will silently corrupt an address and break the asset allowlist.

## Stack

Hardhat 2 + OpenZeppelin 5 (contract), viem + `@x402/core`/`@x402/evm` (the real, standard x402 EVM "exact" scheme implementation), meter402 (streaming settlement core, already live on two other chains), Express (facilitator/demo HTTP), TypeScript throughout.
