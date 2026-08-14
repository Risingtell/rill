#!/usr/bin/env node
/**
 * fxrp3009 CLI.
 *
 * Four commands, each answering a question you would otherwise have to write a script
 * for: what does this address hold, what did a provider actually settle, how long did
 * a given tick pay for, and does a zero-gas payment really work end to end.
 *
 *   fxrp3009 balance <address> [--network coston2|flare]
 *   fxrp3009 verify --payee <addr> [--shim <addr>] [--network ...]
 *   fxrp3009 decode-nonce <0x...>
 *   fxrp3009 pay <resource-url> --key <0x...> --facilitator <url> [--budget 1000000]
 */
export {};
