# Rill: architecture spec

Flare Summer Signal, Track 1 (Interoperable Asset Products).
Deadline 2026-08-14 19:59 UTC. Judging 15 to 21 Aug (must stay live through judging).

Working name `Rill` (a small stream) to sit with Sluice / Spigot / Driplet. Cheap to change.

**One line:** a per-second metered payment rail for AI agents, priced in USD, settled in real
FXRP, funded by an XRPL holder who never leaves XRP and never holds a Flare gas token.

---

## 1. The gap this fills (verified 2026-07-29, not taken from docs alone)

Flare's own x402 guide says:

> "FXRP will be supported once it implements the required EIP-3009 standard
> (`transferWithAuthorization`). This guide will be updated when FXRP gains EIP-3009 support."

So their x402 guide demonstrates with **MockUSDT0**, not FXRP. x402 is the protocol the whole
agent-payments world is standardising on, and it does not work with Flare's flagship FAsset.

I verified this against the deployed contract rather than trusting the doc.

FXRP on Coston2 `0x0b6A3645c240605887a5532109323A3E12273dc7` is a 177-byte proxy over
implementation `0xebac2f4e8306488fcbf07ea42e610da5b8cd2643`. Selector scan of the implementation:

| Feature | Selector | Present |
|---|---|---|
| `permit` (EIP-2612) | `d505accf` | **yes** |
| `nonces` | `7ecebe00` | **yes** |
| `DOMAIN_SEPARATOR` | `3644e515` | **yes** |
| `transferWithAuthorization` (EIP-3009) | `e3ee160e` | **no** |
| `receiveWithAuthorization` | `ef55bec6` | **no** |
| `cancelAuthorization` | `5a049a70` | **no** |
| `authorizationState` | `e94a0102` | **no** |

`authorizationState(...)` reverts on a live `eth_call`; `nonces(...)` returns cleanly. Confirmed.

`eip712Domain()` returns name **`FXRP`**, version `1`, chainId 114, verifyingContract = the proxy.
Decimals 6.

> **Minor trap:** on Coston2 `symbol()` is `FTestXRP` while `name()` and the EIP-712 domain name
> are both `FXRP`. Deriving a permit domain from `name()` is correct on both networks; only code
> that reaches for `symbol()` breaks. On mainnet all three read `FXRP`.

**Mainnet checked too** (`0xAd552A648C74D49E10027AB8a618A3ad4901c5bE`, chain 14, implementation
`0x53cfb685d773cfaa657ff07b70602d3cf27525d3`, which is a different implementation from Coston2
but has the same feature profile): `name()` = `symbol()` = `FXRP`, `nonces(...)` returns cleanly, and
`authorizationState(...)` reverts. **The EIP-3009 gap is real on mainnet as well as testnet**, and
`permit` is available on both. The claim holds unqualified.

**The insight the docs miss:** FXRP already has EIP-2612 `permit`. Flare's *own* gasless-FXRP
guide ignores this. It builds a bespoke `PaymentRequest` EIP-712 type behind a custom forwarder
**and still requires a one-time on-chain `approve`**. That approval is unnecessary. `permit` gives
a gasless allowance, and a bespoke type means no standard x402 client can talk to it.

## 2. The contribution

**`FXRP3009`, an EIP-3009 authorization shim for FXRP.**

A contract implementing the *exact standard* `TransferWithAuthorization` / `ReceiveWithAuthorization`
typehashes, random-`bytes32` nonce set, and `validAfter` / `validBefore` semantics, which moves
**real FXRP** via `transferFrom`, with the allowance established gaslessly by EIP-2612 `permit`.

Why this beats the two obvious alternatives:

- **A wrapper token would be worse.** A `wFXRP` implementing EIP-3009 would fragment liquidity
  and mean agents pay in a derivative. Here the payer holds and pays real FXRP throughout.
- **Copying Flare's custom forwarder would also be worse.** Because our typehashes are the
  standard ones, an *unmodified* x402 facilitator and an *unmodified* x402 client work against it.
  That is the whole point: it makes Flare's own published x402 guide run on FXRP today, which
  lets them delete MockUSDT0.

Payer signs two things off-chain and broadcasts nothing: one `permit` at session open, then one
authorization per tick. Zero C2FLR ever needed.

**The one concession the standard forced, found by running it (2026-08-13):** x402's `exact` scheme
confirms a settlement by scanning the receipt for an ERC-20 `Transfer` emitted *by the asset address
it was handed*. That address is the shim, but the real movement is emitted by FXRP, so a perfectly
valid payment came back as `invalid_exact_evm_transfer_event_mismatch`. The shim therefore mirrors
the movement with its own `Transfer` event. It is a log only: nothing is minted, nothing is
custodied, and every balance still lives in the FXRP contract. Without it the claim in this section,
that an unmodified x402 facilitator works against FXRP, would simply be false.

**Metering data rides along on the nonce.** EIP-3009 needs a unique `bytes32` per authorization and
the shim emits it as an indexed topic anyway, so the low 6 bytes carry the tick's duration in
milliseconds behind a `0x524C` marker (`shared/tick-nonce.ts`). Per-second accounting therefore
lands on-chain at zero extra gas, and the console's totals are recomputable by anyone from explorer
data alone rather than being a claim about our own database.

**Nonce hazard, handled:** EIP-2612 `permit` nonces are *sequential*, so concurrent permits race.
EIP-3009 nonces are *random bytes32* and don't. Design consequence: exactly **one** permit per
session, at open, for the session's full budget. Every subsequent tick is a pure EIP-3009
authorization against the standing allowance. That removes the concurrency problem and saves a
signature on every tick.

## 3. The four Flare systems, each load-bearing

Judges call out superficial integrations by name, so each of these has to do real work:

1. **FAssets / FXRP** is the settlement asset. It is not decorative, because the shim exists
   specifically to fix FXRP's EIP-3009 gap.
2. **Flare Smart Accounts** handle funding. An XRPL holder sends one XRP payment with a memo; that
   auto-mints FXRP and opens the session. They never touch Flare, never bridge manually, never
   acquire gas. This is the "interoperable asset product" the track is asking for.
3. **FTSO** handles pricing. The rate is quoted in USD per second; FTSO converts to FXRP at settlement.
   An agent budgets in dollars while the rail settles in XRP-backed value.
4. **meter402** is the metering core (already proven on Arc testnet and X Layer mainnet). Provides
   `quoteTick` / `commitTick`, the store, and the `SettlementProvider` interface. New here:
   an `Fxrp3009SettlementProvider`.

## 4. Flow

```
XRPL user --XRP payment + memo--> Smart Account --auto-mint--> FXRP on Flare
                                                                  |
                                                      one permit (gasless)
                                                                  v
agent --signed EIP-3009 auth per tick--> facilitator --> FXRP3009 --transferFrom--> provider
              ^                                                |
              |                                          FTSO: USD/sec -> FXRP
        meter402 gates the next chunk on the tick landing
```

If the agent stops paying, the gate shuts. Every tick is one on-chain settlement that anyone can
check independently.

## 5. Deliverables

- `contracts/FXRP3009.sol` + Hardhat tests (replay, expiry, cancel, wrong-signer, over-spend).
  Hardhat rather than Foundry: Flare's official starter is `flare-hardhat-starter`, Foundry is not
  installed and is awkward on Windows, and the rest of the stack is already TypeScript and viem.
- `packages/provider`, the `Fxrp3009SettlementProvider` for meter402
- `apps/facilitator`, an x402 facilitator speaking standard `exact` on `flare-coston2`
- `apps/demo`, a priced agent endpoint plus a live console showing ticks landing
- Smart Accounts funding path (XRP memo -> session open)
- README on the hackathon rubric: what existed before (meter402, Sluice), what is new (the shim,
  the provider, the funding path), what was ported, why it matters
- Demo video + a real Coston2 transaction link

## 6. Hosting

28 of 37 FCC endpoints in the July census were already dead when probed, and judging runs a week
*after* submission. **No ngrok, no trycloudflare.** Deploy the facilitator and console to a real
host (Render/Vercel) that will still answer from 15 to 21 August.

**Resolved 2026-08-13.** Both services are live on Vercel. The console got there by being made
genuinely stateless rather than by finding a host that runs a persistent process: session and quote
state travel with the client as HMAC-signed tokens (`shared/session-token.ts`), and every figure the
console reports is read back from Coston2 (`shared/chain-impact.ts`). The failure this avoids is not
theoretical: the first serverless deploy 404'd on every tick, because the instance that opened a
session was not the instance that received the next request. It also means a cold start, a redeploy
or a week of idling cannot reset the numbers a judge sees to zero.

## 7. Open risks

- ~~Mainnet FXRP may differ from Coston2.~~ **Closed 2026-07-29.** Scanned, same profile, see §1.
- **Flare could ship EIP-3009 on FXRP** before 14 Aug, which would blunt the contribution. Reframe
  available if so: the metering layer and XRPL-native funding stand on their own.
- **Calendar collision.** KeeperHub is due 13 Aug and Spigot CP3 on 9 Aug. Three deadlines inside
  one week. See below.

## 8. KeeperHub overlap, and the call

They **cannot** share a codebase. KeeperHub mandates KeeperHub as the onchain execution layer;
Flare Track 1 mandates deep FAssets integration. Forcing one repo to serve both produces exactly
the superficial integration both rubrics punish.

They **should** share the primitive. `meter402` is already a published npm package. Both entries
depend on it and each contributes a different `SettlementProvider`: `Fxrp3009SettlementProvider`
here, a KeeperHub one there. Same thesis, two honest products, and every entry drives stars back
to the owned repo, which is the stated point of meter402.

Sequence them: Spigot CP3 (9 Aug) -> KeeperHub (13 Aug) -> Flare (14 Aug). Flare last is tight but
it is the only ordering the fixed dates allow.
