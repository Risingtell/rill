# Judge quickstart

Two routes: click one link and check it against a block explorer (30 seconds), or clone and run everything (under 5 minutes). Both are below.

## The 30-second version

Open **[rill-demo.vercel.app](https://rill-demo.vercel.app)**.

Every figure on that page was read back from Coston2, not from the server's memory, and the page tells you exactly which addresses to check. Two things worth verifying by hand:

1. **The agents have no gas.** Open [`0xBDF3866Bb0c6499d8c1dD0a4c46c0b4E6cBb3E28`](https://coston2-explorer.flare.network/address/0xBDF3866Bb0c6499d8c1dD0a4c46c0b4E6cBb3E28) on the explorer (or either of the other two paying addresses, [`0x4340c607...`](https://coston2-explorer.flare.network/address/0x4340c607BE4764C8872477381Ee2dbF6EAf58599) and [`0x935BBD6a...`](https://coston2-explorer.flare.network/address/0x935BBD6a504653fD9165cc9b5b8bA6B7141f7aF6)). Their C2FLR balance is zero and always has been. It has still paid for every second of stream it consumed, because the facilitator broadcasts on its behalf against a signed EIP-3009 authorization. That is the entire point of the shim.

2. **The "seconds streamed" figure is on-chain, not ours.** Pick any settlement row, click through to the transaction, and look at the `AuthorizationUsed` event's `nonce`. The last 8 bytes read `524c` followed by a 6-byte big-endian millisecond count. For example [this settlement](https://coston2-explorer.flare.network/tx/0x20a1afe511de41a90130a29546c0326bfbf892bc6a59178dc9d1864823d86a92) carries a nonce ending `524c0000000029ca`: `0x29ca` = 10698ms = **10.698 seconds**, which is exactly the figure the console reports for that row. Rill packs the metered duration into the EIP-3009 nonce, which is already emitted as an indexed topic, so per-second metering data lands on-chain at no extra gas and anyone can recompute the totals without trusting us.

The contract's source is [verified on the explorer](https://coston2-explorer.flare.network/address/0xf073D2f6cf681cc0E3a4d391f661a994Bd32aCFa#code).

## The full version

### Prerequisites

- Node.js 18+ (built and tested on v24)
- No API keys, no signup, nothing on the critical path below

### 0. One command that checks everything

```bash
npm install
npm run verify
```

It runs both test suites, pings both live services, reads the settlement totals off
Coston2, and prints the paying agent's gas balance (which should be zero). Every
figure quoted in the README comes from here, so nothing in the docs can quietly go
stale. Add `--offline` to skip the network checks.

### 1. Clone and install

```bash
git clone <this-repo-url>
cd rill
npm install
```

### 2. Prove the core claim: the EIP-3009 shim works

```bash
npm run compile
npm test
```

**Expected: all passing.** This is the whole thesis: `contracts/FXRP3009.sol` implementing standard `TransferWithAuthorization`/`ReceiveWithAuthorization` against a permit-funded allowance, covering replay, expiry, not-yet-valid, wrong-signer, over-spend, cancel, both authorization paths, and the mirrored `Transfer` event that lets a stock x402 facilitator confirm settlement.

### 3. Prove the x402 integration is real, not hand-rolled

```bash
npm run typecheck:services
npm run test:services
```

**Expected: all passing.** `packages/provider/Fxrp3009SettlementProvider` calls `@x402/evm`'s actual `registerExactEvmScheme`, the same EVM "exact" scheme implementation a stock facilitator runs against USDC, not a custom verify/settle check. See `packages/provider/index.ts`.

Also covered here: the tick-nonce codec (`shared/tick-nonce.ts`), the chain-derived impact feed and its filtering rules (`shared/chain-impact.ts`), the signed session tokens including the tamper cases (`shared/session-token.ts`), and a set of integration tests that drive the real Express app end to end, covering the full open/quote/settle/close cycle, session-token rotation across ticks, forged and tampered tokens, the zero-amount guard, and two concurrent agents not clobbering each other.

### 4. Run the demo locally (mock settlement, no gas needed)

```bash
npx tsx apps/demo/server.ts
```

In a second terminal:

```bash
npx tsx apps/demo/agent.ts
```

Then open **http://localhost:8403**. `apps/demo/agent.ts` signs a real EIP-3009 `TransferWithAuthorization` for each tick and the server settles it through the same provider from step 3. Identical code path to the live deployment, just pointed at `MockSettlementProvider` instead of a funded key.

### 5. Point the same agent at the live deployment

If you have a Coston2 key holding FXRP, the published console will show your settlements appear:

```bash
RILL_DEMO_URL=https://rill-demo.vercel.app \
RILL_FACILITATOR_URL=https://rill-facilitator.vercel.app \
RILL_CHAIN_ID=114 \
RILL_SHIM_ADDRESS=0xf073D2f6cf681cc0E3a4d391f661a994Bd32aCFa \
RILL_AGENT_KEY=<your key> \
  npx tsx apps/demo/agent.ts
```

Your key needs FXRP but **no C2FLR**: gas is the facilitator's problem, which is the property being demonstrated.

### 6. Or reproduce the raw on-chain proof

```bash
RILL_SHIM_ADDRESS=0xf073D2f6cf681cc0E3a4d391f661a994Bd32aCFa \
  npx hardhat run scripts/prove-live-settlement.ts --network coston2
```

**Expected:** two successful transactions (a permit, then a transferWithAuthorization), and a printout confirming a fresh random address's FXRP balance moved from 0 to exactly the authorized amount.

## Where to check each claim

| Claim | Where to check it yourself |
|---|---|
| Every number in the README | `npm run verify`, which re-measures all of them |
| Contract tests | `npm test`, step 2 |
| Service and integration tests | `npm run test:services`, step 3 |
| Real `@x402/evm` scheme, not hand-rolled | `packages/provider/index.ts`, the `registerExactEvmScheme` import |
| Contract source matches what is deployed | [verified source on the explorer](https://coston2-explorer.flare.network/address/0xf073D2f6cf681cc0E3a4d391f661a994Bd32aCFa#code) |
| Agent pays without ever holding gas | [agent address](https://coston2-explorer.flare.network/address/0xBDF3866Bb0c6499d8c1dD0a4c46c0b4E6cBb3E28) on the explorer: zero C2FLR |
| Console numbers come from the chain | [provider address token transfers](https://coston2-explorer.flare.network/address/0xD7Ed634428b091eb8ead65c363D0648AC3D27051?tab=token_transfers), and `shared/chain-impact.ts` |
| Per-second durations are on-chain | any settlement's `AuthorizationUsed` nonce, decoded per the 30-second version above |
| Live FTSO pricing | `shared/ftso.ts`, and the XRP/USD figure on the console |
| Smart Accounts memo encoding | `shared/smart-account-funding.ts` + its test in `test-services/` |
