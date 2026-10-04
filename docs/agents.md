# Bondline for agents: SDK and MCP server

Bondline's markets are open to agents that are not ours. `@bondline/sdk` (TypeScript, viem) reads offers, quotes and
records, and builds **unsigned** transactions. `@bondline/mcp` puts the same thing behind six tools for any MCP
client. Neither holds a key or sends a transaction: your wallet signs and sends.

Testnet, unaudited. A capped, fully backed protection bond, not regulated insurance. Independent project, not
affiliated with Robinhood.

## Quickstart

From the repository root, in a clean shell (Node 22 or newer). Every line below was run that way on 4 Oct 2026.

```sh
npm install
npx bondline offers --listed
npx bondline quote --market live --offer 0 --amount 100 --limit-bps 1000
npx bondline record careful
node mcp/bin/bondline-mcp.mjs
```

The first command installs the workspaces. The next three read the Robinhood Chain testnet deployment through its
public RPC (set `BONDLINE_RPC_URL` to use another) and print JSON. The last starts the MCP server on stdio, which waits
for a client; point your MCP client at it:

```json
{ "mcpServers": { "bondline": { "command": "node", "args": ["/absolute/path/to/surety/mcp/bin/bondline-mcp.mjs"] } } }
```

## The MCP tools

| Tool | What it does |
|---|---|
| `list_offers` | Each market's offers: terms (limit range, premium, most in stocks), bond, reserved, free, lifetime premiums, claims paid, covered accounts. Filter by `market`, `agent`, `listed_only`. |
| `quote_cover` | For `market`, `offer_id`, `amount` (USDG), `limit_bps`: the premium, the principal, the loss limit, the bond the deposit reserves, whether the offer's free bond allows it, the reference price from the published model (not actuarial, see [PRICING](PRICING.md)) and the agent's record. `problems` lists the checked term, rule, capacity and optional balance failures. It does not guarantee execution: issuer pause/freeze controls, changing chain state and token failures may still cause a revert. |
| `get_agent_record` | The agent's public record snapshot from `shared/src/records` (score, trades, refusals, exposure, drawdown, claims). `record: null` if there is none. |
| `build_cover_transactions` | Two unsigned transactions for the user, in order: `USDG.approve` for exactly the deposit, then `open(limitBps, rules, amount)`. Refuses what the quote refuses. |
| `build_offer_authorization` | Underwrite an agent with one signature. Step 1 (market, underwriter, agent, terms, bond) returns EIP-712 typed data (USDG's `ReceiveWithAuthorization`). Step 2 (`authorization` + `signature`) checks the signer is the underwriter and returns the one `createOfferWithAuthorization` transaction. |
| `build_trade_transaction` | An unsigned `trade(asset, isBuy, usdAmount, minOut, decision)` for the account's agent, with the canonical decision JSON and its `keccak256`, which is the `decisionHash` the event will carry. |

Amounts are USDG as decimal strings (`"100"`, `"0.5"`, at most 6 decimals); raw fields in results are base units
(6 decimals) as strings. Errors come back as tool errors with a message, never as a thrown transaction.

## The SDK

```ts
import { Bondline, configFromEnv } from "@bondline/sdk";
const sdk = new Bondline(configFromEnv()); // the testnet, or BONDLINE_RAW_DEPLOYMENT + BONDLINE_RPC_URL for a local deploy
await sdk.listOffers({ market: "live", listedOnly: true });
await sdk.quoteCover({ market: "live", offerId: 0, amount: "100", limitBps: 1000 });
sdk.getAgentRecord("0x230d2a366d7724a6f5F416BB1d80299BC8E487eF");
```

Reads: `listOffers`, `getOffer`, `getMarket`, `quoteCover`, `quoteTrade`, `listAccounts({ agent | user | market })`,
`getAgentRecord`, `verifyDecision(txHash)`. Builders: `buildCoverTransactions`, `buildOfferAuthorization` with
`buildCreateOfferFromSignature`, `buildTradeTransaction`. Pure versions of the builders (no network) are exported
from `@bondline/sdk` too, along with `encodeDecision` and `validateRules` / `validateTerms`, which mirror the
contracts' own checks.

### An outside agent, end to end

Three steps, each sent by the wallet that must send it. The code is [sdk/examples/outside-agent.ts](../sdk/examples/outside-agent.ts)
(type-checked); the same calls run in [sdk/test/e2e.test.ts](../sdk/test/e2e.test.ts).

1. **Underwrite.** The underwriter signs once (`buildOfferAuthorization` then `signTypedData`) and sends one
   transaction (`buildCreateOfferFromSignature`). The offer names the agent's address: it is the only address that can
   trade accounts covered by that offer. The market pulls the bond with EIP-3009 `receiveWithAuthorization`, always
   from the sender, so the signature cannot be used or redirected by anyone else. The agent's operator can be its own
   underwriter.
2. **Cover.** A user picks the offer and a loss limit. `buildCoverTransactions` returns the approval for exactly the
   deposit and the `open`. The premium comes out of the deposit; the rest goes to the user's own `AgentAccount`, with
   the rules the user chose (the SDK's defaults are the team's Careful agent's rules).
3. **Trade.** The agent finds its accounts (`listAccounts({ agent })`) and sends `buildTradeTransaction`. The decision
   JSON travels in the transaction input and its hash in the event, so anyone can re-hash it:
   `verifyDecision(txHash)` does that and compares. A trade that breaks a rule the account checks does not revert:
   the account emits `Blocked` with the reason and changes nothing. Submitted trades that complete emit `Traded` or a
   rule-check `Blocked` receipt with a hash of the submitted decision bytes. Off-chain holds and decisions never
   submitted are absent, and token or RPC failures may produce no receipt. The hash verifies the bytes, not that a
   model produced them.

### Decision JSON

`encodeDecision(obj)` writes canonical JSON (sorted keys, no whitespace, at most 800 bytes; a long `reason` is
shortened to fit) and returns `{ json, hex, hash }`. A string is used byte for byte. The hash equals the one the
Bondline agents produce for the same object (tested against `agents/src/decision.ts`). The contract only hashes the
bytes; it does not read them.

## What to know before using it

- `minOut` is in base units (stock tokens for a buy, USDG for a sell). Leave it out and there is no floor of your own
  (the SDK warns); the account's slippage rule still applies. `minOutToleranceBps` takes it from the demo exchange's
  current quote instead. Testnet Stock Tokens have no market: the demo exchange fills at the oracle price less a
  fixed spread, from inventory the team supplies.
- `quote_cover`'s reference price is the model in [PRICING](PRICING.md): "A reference price from a simple published
  model, not actuarial." It prices 30 days of cover on the principal; the contract charges its premium once, from the
  deposit. An agent with no record gets only the reference price at the maximum stock share allowed after a buy.
- Records are static snapshots (they carry `generatedAt`), rebuilt from chain events by `npm run record`. An outside
  agent has none until one is built; the tools return `null` rather than a score.
- `capacityAllows` is `reservationNeeded <= free + premium`, because the contract adds the premium to the bond before
  checking.
- The Replay market runs sped-up real prices and the team's test accounts are team-operated; `list_offers` marks the
  team's underwriter (`underwriterIsTeam`) so you can leave it out of "outside" counts.

## Tests

| Command | What it checks |
|---|---|
| `npm test -w @bondline/sdk` | Unit tests: units, decision JSON (including equality with the agents' encoder), the unsigned builders decoded back, the contracts' bounds, the quote arithmetic against a stubbed chain, the reference price against the published `PRICING_VECTORS` row. |
| `npm run test:e2e -w @bondline/sdk` | A local Anvil chain on port 8551, deployed with `contracts/script/Deploy.s.sol` (`LOCAL=true`, Anvil's public keys, mock USDG): an outside agent gets an offer by one signature and one transaction, a user opens a cover with SDK-built transactions, the agent trades through SDK-built transactions (one executed, one refused as `Blocked`, one sell-all). Checks the events and that the decision hash verifies, by the SDK and independently. |
| `npm test -w @bondline/mcp` | The same chain, with a real MCP client talking to `bondline-mcp` over stdio: all six tools, the one-signature flow through the JSON typed data, the cover and trade transactions sent on chain, and the error cases. |
| `npm run test:live -w @bondline/sdk` | Read-only checks against the deployed testnet (needs network, sends nothing). |

The end-to-end tests are local: Anvil keys, a mock USDG, a throwaway chain. They show the SDK and server build
transactions the contracts accept; they are not transactions on Robinhood Chain testnet.
