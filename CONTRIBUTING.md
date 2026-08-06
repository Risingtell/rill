# Contributing to Rill

This started as a hackathon entry for Flare Summer Signal, so it's small and the whole
thing can be read in an afternoon. `SPEC.md` has the full architecture rationale;
`README.md` has the verified-claims table; `JUDGE-QUICKSTART.md` has the fastest path
to running it yourself.

## Getting set up

```
npm install
npm run compile         # Hardhat, compiles contracts/FXRP3009.sol
npm test                # 12 deterministic contract tests, no network needed
npm run typecheck:services
npm run test:services   # 3 tests covering the Smart Accounts memo encoding
```

None of the above need anything from you: no signup, no API key, no funded wallet.
If any fails on a fresh clone, that's a bug worth reporting on its own.

To run the demo against real Coston2 rather than mock settlement, you additionally
need a funded facilitator key and a deployed `FXRP3009` (see `scripts/deploy.ts`):

```
RILL_FACILITATOR_KEY=... RILL_SHIM_ADDRESS=... RILL_PAYEE_ADDRESS=... npx tsx apps/demo/server.ts
```

## Before opening a pull request

Run all four and make sure they pass:

```
npm run compile
npm test
npm run typecheck:services
npm run test:services
```

## House rules for this codebase

- **Verify against real infrastructure, don't assume.** Every contract address, feed
  ID, and package API in this repo was confirmed against the real deployed contract or
  the real npm package, not copied from a doc's prose. `shared/ftso.ts`'s
  `ContractRegistry` address and `shared/smart-account-funding.ts`'s instruction shapes
  are both examples — if you add a constant, add (or point to) the check that proves it.
- **Never guess an ABI or address you can't verify.** `shared/smart-account-funding.ts`
  intentionally leaves the Flare smart account's `executeUserOp` ABI as a caller-supplied
  parameter rather than fabricating it. If you complete that integration, verify the ABI
  against Flare's deployed contracts first.
- **One permit per session, never per tick.** EIP-2612 `permit` nonces are sequential and
  race under concurrency; EIP-3009 nonces are random and don't. Don't reintroduce a permit
  call inside the per-tick path.
- **Plain English in comments and docs.** No em dashes, no long dashes. Use commas, full
  stops, or restructure the sentence.

## Reporting a bug

Open an issue using the bug report template. The most useful thing you can include is the
exact command you ran and its full output, so the behavior can be checked against the
chain rather than guessed at.
