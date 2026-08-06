**What this changes**

**Why**

**How it was verified**

Please say what you actually ran, not what should work in theory.

- [ ] `npm run compile` passes
- [ ] `npm test` passes (12 contract tests)
- [ ] `npm run typecheck:services` passes
- [ ] `npm run test:services` passes (3 tests)
- [ ] Tested against a live Coston2 deployment (include the transaction hash if a
      write was involved)

**Does this touch the money path?**

- [ ] No, this is read-only, docs, or tooling
- [ ] Yes, and I have read the design notes in `SECURITY.md`

If yes, confirm the following still hold:

- [ ] The facilitator's asset allowlist still rejects any asset that isn't the
      configured FXRP3009 shim
- [ ] `/sponsor-permit` still always targets the real FXRP address for the
      configured chain, never a client-supplied one
- [ ] Still exactly one `permit` per session, never one per tick
- [ ] `Fxrp3009SettlementProvider.settle()` still checks the staged
      authorization's value/payee against the quoted amount before settling

**Anything a reviewer should look at closely**
