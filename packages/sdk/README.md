# fxrp3009

**EIP-3009 authorizations for Flare's FXRP. Pay for x402-metered resources holding zero gas token.**

FXRP implements EIP-2612 `permit` but none of EIP-3009, so no standard x402 client or
facilitator can move it. That is why Flare's own x402 guide demos against a mock token
instead of its flagship FAsset. This package is both halves of the fix.

```bash
npm install fxrp3009 viem
```

## Pay for something, holding no gas

```ts
import { privateKeyToAccount } from "viem/accounts";
import { Fxrp3009Client } from "fxrp3009";

const client = new Fxrp3009Client({
  account: privateKeyToAccount(process.env.KEY),
  chainId: 114,                                    // 114 Coston2, 14 Flare mainnet
  facilitatorUrl: "https://rill-facilitator.vercel.app",
});

await client.openSession({ budget: 1_000_000n });  // one gasless permit, ~1 FXRP
const res = await client.fetchPaid("https://provider.example/stream", { method: "POST" });
```

`fetchPaid` speaks standard x402: it takes the 402, reads the payment requirements,
signs an EIP-3009 authorization for exactly the quoted amount, and resubmits. The
server needs no knowledge of this library. The payer's gas balance stays at zero,
because a facilitator broadcasts every transaction.

The EIP-712 domain is read from the server's own 402 response rather than compiled in
here, which is what makes this a standard client rather than one that only talks to
servers it was built against.

## CLI

```bash
npx fxrp3009 balance 0xBDF3866Bb0c6499d8c1dD0a4c46c0b4E6cBb3E28
npx fxrp3009 verify --payee 0xD7Ed634428b091eb8ead65c363D0648AC3D27051
npx fxrp3009 decode-nonce 0xd0146c...524c000000001c8b
npx fxrp3009 pay <url> --key 0x... --facilitator https://rill-facilitator.vercel.app
```

`verify` rebuilds a provider's settlement totals straight from the block explorer, so
you never have to take a provider's own dashboard at its word.

## Metering data that lands on chain for free

EIP-3009 requires a unique `bytes32` nonce per authorization, and the contract emits it
as an indexed topic regardless. So the low 6 bytes carry the duration the tick paid for,
in milliseconds, behind a `0x524C` marker:

```ts
import { encodeTickNonce, decodeTickNonceMs } from "fxrp3009";

const nonce = encodeTickNonce(7307);   // use as the authorization nonce
decodeTickNonceMs(nonce);              // 7307
```

Per-second metering therefore becomes auditable from block explorer data alone, at no
extra gas, and `decodeTickNonceMs` returns `undefined` for any nonce not carrying the
marker rather than inventing a number.

## Server side

```ts
import { createFxrp3009Facilitator, Fxrp3009SettlementProvider } from "fxrp3009";
```

`createFxrp3009Facilitator` builds an x402 facilitator registered for the exact/EIP-3009
scheme using `@x402/evm`'s real `registerExactEvmScheme`, not a hand-rolled verifier.
`Fxrp3009SettlementProvider` plugs the same path into [meter402](https://www.npmjs.com/package/meter402)
for per-second streaming settlement. Both are optional peer paths: install `@x402/core`,
`@x402/evm` and `meter402` only if you use them.

## Deployments

| Network | FXRP3009 | FXRP |
|---|---|---|
| Coston2 (114) | `0xf073D2f6cf681cc0E3a4d391f661a994Bd32aCFa` | `0x0b6A3645c240605887a5532109323A3E12273dc7` |
| Flare mainnet (14) | `0xb1a5826C3Ae8afDfB724D0DBaEEbAa4841605B86` | `0xAd552A648C74D49E10027AB8a618A3ad4901c5bE` |

Both shims are source-verified on their explorer. Settlement history so far is on
Coston2; the mainnet deployment is live but unexercised.

## Notes worth knowing

- **The shim mirrors an ERC-20 `Transfer` event.** x402 facilitators confirm settlement
  by scanning the receipt for a `Transfer` from the asset address they were handed, and
  the real movement is emitted by FXRP rather than the shim. The mirror is a log only:
  it mints nothing and custodies nothing, and every balance still lives in FXRP. Note
  that block explorers may index the shim as if it were a token.
- **The shim never holds funds.** Every authorization moves FXRP directly from payer to
  payee via `transferFrom` against a permit-funded allowance.
- **One permit per session, not per payment.** EIP-2612 nonces are sequential and race
  under concurrency; EIP-3009 nonces are random and do not.
- Not audited. Testnet keys used in the examples above are throwaway.

## License

MIT. Source: https://github.com/Risingtell/rill
