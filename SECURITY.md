# Security policy

Rill's facilitator executes real on-chain transactions and pays gas on a payer's
behalf. The notes below are specific to this project, not generic advice.

## Scope and current status

Rill currently targets **FXRP on Flare Coston2 (chain id 114)**, a testnet, with the
same contract profile confirmed on Flare mainnet (chain id 14) but not yet deployed
there. It has not been audited and is not production ready. Do not point it at a
mainnet deployment or a key holding real value without an independent review first.

## Known dependency vulnerabilities (accepted, dev-tooling only)

`npm audit` reports vulnerabilities in Hardhat 2's own bundled toolchain
(`hardhat-toolbox`'s compiler wrapper, test helpers, gas reporter, and their
transitive deps). All of them require jumping to Hardhat 3 to clear, a breaking
migration deliberately avoided here for stability. None of these packages run
against the deployed contract or the live facilitator/demo services; they only
execute locally during `npm run compile` / `npm test`. Accepted as a known limitation
rather than risking a late, disruptive toolchain migration on a working, verified
system. Revisit once Hardhat 2 patches its own dependency tree, or when migrating to
Hardhat 3 can be scheduled with time to re-verify everything against it.

## Credentials this project touches

- **`RILL_FACILITATOR_KEY`** pays gas for every settlement and every sponsored permit.
  Anyone holding it can spend its native-token balance. It belongs in a gitignored env
  file, never committed, never pasted into an issue or pull request. Rotate it if it's
  ever exposed. `.throwaway-key.local` (the local dev deployer key) is generated fresh
  per clone and gitignored for the same reason.
- **`RILL_AGENT_KEY`** (used only by `apps/demo/agent.ts`) never needs gas by design,
  that's the entire point of the shim. It only ever produces off-chain signatures.
  Still treat it as a real key: use a throwaway testnet-only one.

## Design decisions that exist for safety reasons

If you're changing the facilitator or the shim, these are load-bearing.

- **`apps/facilitator`'s asset allowlist is not decorative.** `router.ts`'s `screen()`
  refuses to verify or settle any `paymentRequirements.asset` that isn't the exact
  configured FXRP3009 shim address. Without it, a malicious request could point the
  facilitator's `verify`/`settle` at an arbitrary contract and spend its gas on
  something unrelated to this project.
- **`/sponsor-permit` always targets the real FXRP address for the configured chain**
  (`FXRP_ADDRESS[fac.chainId]`), never a client-supplied token address. A permit-relay
  endpoint that accepted an arbitrary token address would be an open gas-spending relay.
- **The shim never custodies funds.** `transferWithAuthorization` and
  `receiveWithAuthorization` both call `transferFrom` directly between `from` and `to`.
  FXRP passes straight from payer to payee. There is no balance sitting in the contract
  for a bug to strand or a reentrancy path to drain.
- **Exactly one `permit` per session, never one per tick.** EIP-2612 `permit` nonces are
  sequential, so concurrent permits race; EIP-3009 nonces are random `bytes32` and don't.
  Reintroducing a permit call inside the per-tick path would reopen that race. See
  SPEC.md section 2 for the full reasoning.
- **`Fxrp3009SettlementProvider.settle()` checks the staged authorization's `value` and
  `to` against the quoted amount before ever calling the facilitator.** This is what
  makes the two-phase 402 flow in `apps/demo/server.ts` safe: the server quotes once,
  stashes that exact quote, and refuses to settle anything that doesn't match it exactly,
  closing the window where a re-quote could drift from what the client signed.
- **`shared/smart-account-funding.ts` deliberately does not guess Flare's
  `executeUserOp` ABI.** Fabricating a plausible-but-wrong ABI here would produce a memo
  that looks valid but silently fails, or worse, executes something unintended, once
  real infrastructure is wired to it. That seam stays an explicit caller-supplied
  parameter until the real ABI is confirmed against Flare's deployed contracts.

## Reporting a vulnerability

Please don't open a public issue for a security problem.

Use GitHub's private vulnerability reporting on this repository (the **Security** tab,
then **Report a vulnerability**), or contact the maintainer privately through their
GitHub profile at [@Risingtell](https://github.com/Risingtell).

Expect an acknowledgement within a few days. This is a hackathon project maintained by
one person, so please be patient with response times.
