# Bondline: technical notes

Bondline is a market where independent underwriters put USDG behind AI trading agents, and people whose AI trades
for them buy cover from those underwriters. It runs on Robinhood Chain testnet, with Paxos USDG and Robinhood's
testnet Stock Tokens. Everything here is testnet and unaudited. A cover is a capped, fully backed protection bond,
not regulated insurance.

This file is the depth behind the README: the contracts, the money math, what is trusted, and how it is tested.
The pricing model is in [PRICING.md](PRICING.md).

## 1. The pieces

```
                      BondlineMarket (no owner; one per market: Live, Replay)
                        │  createOffer / createOfferWithAuthorization (one USDG signature)
                        │  deploys OracleVenue (the demo exchange) in its constructor
                        ▼
  underwriter ──► BondlineCover (EIP-1167 clone, one per offer: one bond behind one agent)
                        │  open(limit, rules, amount) clones an account for the caller
                        ▼
  user ──────────► AgentAccount (EIP-1167 clone, one per covered user)
                        │  the agent's only power: trade(asset, isBuy, usd, minOut, decisionJSON)
                        ▼
                   OracleVenue ◄── MirrorFeed (TSLA, AMZN; pushed by our keeper)
```

| Contract | Role | Admin |
|---|---|---|
| `BondlineMarket` | Factory and registry of offers. Fixed config: USDG, assets, feeds, max price age, venue. | None |
| `BondlineCover` | One underwriter's bond behind one agent: premiums, reservations, settle, close. | None. The underwriter can only release free bond. |
| `AgentAccount` | A user's covered account: holds USDG and stocks, enforces the agent's rules. Submitted trades that complete emit `Traded` or a rule-check `Blocked` receipt with a hash of the submitted decision bytes. | None. The user can pause and resume the agent. |
| `OracleVenue` | Demo exchange: fills Bondline accounts at the oracle price less a 10 bps spread, from team-supplied inventory. | None. Inventory leaves only through trades. |
| `MirrorFeed` | Chainlink-compatible price feed (`AggregatorV3Interface`), pushed by one fixed keeper address. | The keeper sets the price (stated trust assumption, see §5). |

Solidity 0.8.28, OpenZeppelin 5.6.1, Cancun EVM (checked on Robinhood Chain testnet: `TSTORE`, `PUSH0` and `MCOPY`
all execute). Reentrancy guards use transient storage, which also makes them clone-safe without initialization.
Clones are initialized in the same transaction that creates them, and the implementations disable their own
initializers. Bondline's own contracts are not upgradeable and its markets have no owner. The fixed keeper controls
testnet prices, which affect trades and payouts; USDG and Stock Tokens retain issuer controls and upgrade paths.

## 2. What the cover pays

For a covered account with principal `P` (net USDG deposited) and limit `l` (basis points), at fresh prices:

```
value  = cash + Σ stocks × oracle price
loss   = max(0, P − value)
limit  = ⌈P × l / 10000⌉                       (rounded up: the user's limit is never shaved)
payout = min(loss − limit, ⌊P × (3000 − l) / 10000⌋)    only if loss > limit
```

Anyone can call `settle`. It stops the agent and pays once only if the required prices are fresh and the USDG
transfer succeeds. Fresh means every held stock's price is valid and within the market's max price age; the payout
goes from the bond to the user. USDG pause/freeze controls and unsolicited listed-stock dust can block settlement in
the current code. The user can still stop the agent with `pause` or end cover with `close`. So, at the moment of
settlement, the user is made whole to `P − limit` (their limit) unless the drop is larger than 30%. After that the
agent is stopped and the stocks still in the account keep moving with the market until the user sweeps them out.

A cover has no fixed term: it runs until the user closes it or it pays out, and its reservation stays locked until
then. The reference price assumes 30 days of cover ([PRICING.md](PRICING.md)); fixed-term covers are roadmap item 2.

A stop-loss can't do this when the price jumps through the limit (a weekend or overnight gap, news): nothing sells
inside a gap. The bond pays the gap; that is the risk underwriters price.

### Every cover is fully backed before it is sold

Every deposit reserves its own worst case, rounded up:

```
fee      = ⌊amount × feeBps / 10000⌋          (the premium; joins the bond)
net      = amount − fee                        (goes to the account; adds to P)
reserve += ⌈net × (3000 − l) / 10000⌉
```

The deposit is refused (`InsufficientCapacity`) unless the free bond (`bond − reserved`, after adding the
premium) covers the new reservation. Because the payout cap is rounded down and the reserve rounded up,
`payout ≤ reserve` always holds. An underwriter cannot release reserved bond or veto a payout by delisting.
Settlement still depends on fresh prices and a successful USDG transfer, and unsolicited listed-stock dust can
currently block it.

### Withdrawals can't raise a payout

A naive design would let a user at a loss withdraw cash, shrink the principal, and so shrink their limit in dollars
while the loss stays the same, raising the payout. `withdraw` instead scales the principal by the share of value
taken out: `P' = ⌊P × (value − amount) / value⌋`. The loss ratio, and with it the payout, can only fall
(fuzz-tested). The reservation shrinks to the new worst case.

### Close works at any price and moves no tokens

`close` ends the cover (giving up any unsettled payout), frees the reservation and stops the agent, without reading
prices or moving tokens. So it works even if USDG is paused or the user is frozen. The account is then released
and the user can `sweep` (everything) or `sweepToken` (one token, if another is paused).

## 3. The agent can only trade, inside rules it can't break

Each account's rules are fixed when the cover opens, within the offer's terms:

| Rule | Checked against |
|---|---|
| allowed stocks (bit mask) | the traded asset |
| max share in stocks (≤ the offer's `maxStockBps`) | stock value after a buy, as a share of account value |
| max per trade, max per day | the trade's USDG value against account value |
| max price age (≤ the market's) | the traded stock's and every held stock's price |
| max slippage | the venue's fill against the oracle price |

A trade that breaks one of these rules doesn't revert. It emits `Blocked(asset, isBuy, usd, reason, observed, limit,
decisionHash)` and changes nothing. A trade inside the rules emits `Traded(..., valueAfter, stockValueAfter,
decisionHash)`. In both cases `decisionHash = keccak256(decision)`, where `decision` is the decision bytes passed in
calldata, so anyone can take the transaction input and re-hash it. Submitted trades that complete emit `Traded` or a
rule-check `Blocked` receipt with a hash of the submitted decision bytes. Off-chain holds and decisions never
submitted are absent, and token or RPC failures may produce no receipt. The hash verifies the bytes, not that a model
produced them. The agent can never withdraw, and it never holds tokens (an invariant).

The thirteen refusal reasons are, in check order: `Stopped`, `Paused`, `ZeroAmount`, `AssetNotAllowed`, `PriceStale`,
`TradeTooLarge`, `DailyLimit`, `InsufficientCash`, `InsufficientStock`, `StockShare`, `Slippage`, `MinOut`,
`NoLiquidity`. Each has a unit test that checks the exact event.

## 4. One signature, one transaction: underwriting with USDG's built-in authorization

`createOfferWithAuthorization(terms, bond, validAfter, validBefore, nonce, v, r, s)`:

1. `USDG.receiveWithAuthorization(msg.sender, market, bond, …)`: EIP-3009. `from` is always `msg.sender`, and USDG
   reverts `CallerMustBePayee()` unless the caller is the payee (the market), so a seen signature can't be
   front-run, redirected or spent by anyone else.
2. Clone the cover with `underwriter = msg.sender`, approve exactly `bond`, `cover.fund(bond)`.
3. Emit `OfferCreated` and `OfferFunded`. The market holds no USDG afterwards (an invariant).

USDG on Robinhood Chain exposes neither `version()` nor `eip712Domain()`, so the EIP-712 domain is hardcoded:
name "Global Dollar", version "1", chain 46630, the token address. A unit test rebuilds it and matches the on-chain
`DOMAIN_SEPARATOR` (`0xb1de…950b`); a fork test signs against the real token. The same domain shape reproduces
mainnet USDG's separator on chain 4663, and the mainnet-fork test underwrites with one signature there too.

USDG's issuer controls are handled: the site checks `paused()` and `isFrozen(wallet)` before anyone signs; a frozen
user can't receive a payout (USDG reverts), but can still stop the agent with `pause` or `close`.

## 5. Prices, and what we trust

Robinhood Chain testnet has no Chainlink stock feeds, so each market reads `MirrorFeed`s that our keeper pushes:

- **Live market:** the keeper copies Chainlink's TSLA/USD (`0x4A11…7C38`) and AMZN/USD (`0xD5a1…651C`) answers
  from Robinhood Chain mainnet, with their real timestamps. Those feeds have a 24-hour heartbeat and a 0.5%
  deviation threshold, so the live market's max price age is 25 hours. These feeds include updates outside NYSE core
  trading hours. In this historical window (23 June to 2 October 2026, [BACKTEST.md](BACKTEST.md)) the longest
  observed round gaps were 77.8 hours for TSLA and 77.1 hours for AMZN. Settlement waits whenever an included price
  exceeds the market's maximum age.
- **Replay market:** live stock prices are frozen for the weekend, so the keeper replays the real Chainlink rounds
  from 28 Sep – 2 Oct 2026 (79 TSLA rounds, 33 AMZN rounds, read from mainnet), sped up 400 times (the five days ran
  in 18 minutes on 4 Oct 2026, 15:12 to 15:30 IST), with fresh timestamps. No interpolation: the replay price is
  always the latest real round. Max price age: 5 minutes.
- **Scripted gap:** the gap demo moves the replay feeds by script (labelled everywhere). It has paid one real claim:
  a team-operated test account (100 USDG principal, 10% limit, traded by Bold) went from 92 to 75 USDG at the
  scripted Monday open, a 25% loss against its 10% limit, and the bond paid 15.000001 USDG seconds after the
  Monday-open price, block 128646129
  ([settle transaction](https://explorer.testnet.chain.robinhood.com/tx/0xbace67dfa4f25b92eca2f0b2806dc5cf6c9d802608aeee6622fff59cc296087c)).

`MirrorFeed.push` requires a positive answer and a strictly increasing, non-future timestamp. It does not
authenticate the source answer or timestamp: the keeper can submit an old or invented answer with a new timestamp.
That authority affects trades, eligibility to settle and payout amounts. That is the main trust assumption, and it
would go away on mainnet, where markets can read Chainlink directly (the mainnet-fork test does exactly that).

Consumers validate every Chainlink field: a non-positive answer, `startedAt > updatedAt`, or `answeredInRound <
roundId` is treated as no price. The account also checks that the venue quoted at the same oracle price it read.

**The demo exchange** exists because testnet Stock Tokens have no market. It fills at the oracle price less a
fixed 10 bps spread, from inventory the team supplied. The venue accepts registered Bondline accounts, but anyone
can create an offer and account. This is not an admission barrier against trading ahead of the public replay; its
team-supplied inventory remains exposed to that arbitrage.

**Team-operated:** the keeper, the two agents (Careful and Bold, Claude Haiku 4.5), and the test underwriter and
buyer wallets. All are labelled on the site. Anyone can call `settle`.

## 6. Tests

All in Foundry (`contracts/test`). Run `forge test`; fork tests with `FORK_TESTS=true forge test --match-path 'test/fork/*'`.

| Suite | What it proves |
|---|---|
| `AgentAccount.t.sol` | Every refusal reason emits the exact `Blocked` receipt and changes nothing; trades execute at the right fill; pause, resume, stop, sweep; only the cover moves money; the agent can never move money out (fuzz). |
| `BondlineCover.t.sol` | Fee, reserve rounding, capacity refusals, proportional withdrawals, the exact payout (capped and uncapped), settle only once and never on a stale price, close at any price with USDG paused, frozen users; fuzzed payout formula, reserve and withdrawals. |
| `BondlineMarket.t.sol` | Terms validation (fuzzed), offers registry; one-signature underwriting and each failure: wrong signer, `from` ≠ caller, reused nonce, expired, not yet valid, redirection to USDG directly. |
| `OracleVenue.t.sol`, `MirrorFeed.t.sol` | Quotes and spread (fuzzed), only Bondline accounts can trade, stale and invalid prices; keeper-only pushes, monotonic timestamps. |
| `UsdgDomain.t.sol` | The hardcoded EIP-712 domain reproduces the on-chain `DOMAIN_SEPARATOR`; standard EIP-3009 typehashes. |
| `invariant/` | 8 invariants under random sequences of every action (fund, release, open, deposit, withdraw, trade, price moves, settle, close, delist, both underwriting paths): `reserved ≤ bond`; `reserved` equals the sum of reservations; every reservation covers its current worst case; no payout ever exceeds its reservation; every cover holds at least its bond; the market holds no USDG; the agent holds nothing; only market-created covers are offers. A seeded walk proves the handler really executes trades and paid settles. |
| `fork/UsdgFork.t.sol` | Against the real testnet USDG: the domain separator, `CallerMustBePayee()`, one-signature underwriting, a cover opened with an exact approval. |
| `fork/MainnetFork.t.sol` | On a Robinhood Chain mainnet fork: real USDG (one-signature underwriting on chain 4663) and Chainlink's real TSLA/AMZN feeds; the stocks are fork-deployed mocks and the 35% drop is a labelled `vm.mockCall`; settle pays the exact formula in real USDG. |

Results (4 Oct 2026): 172 tests pass, 0 fail, 0 skipped: 168 unit, fuzz and invariant tests plus 4 fork tests (3 on
testnet, 1 on a mainnet fork) ([reports/tests.txt](../contracts/reports/tests.txt)). Line coverage 100% (554/554),
statements 99.7%, branches 98.4%, functions 100% ([reports/coverage.md](../contracts/reports/coverage.md)).
Slither 0.11.6 on every contract: 0 High, 0 Medium ([reports/slither.md](../contracts/reports/slither.md)).

Gas, from [reports/gas.txt](../contracts/reports/gas.txt) (`forge test --gas-report`). The median is over every call in
the test suite, including calls that revert by design (a settle within the limit, a refused deposit), so it can be
lower than a successful call; the max is the most expensive call seen.

| Call | Median | Max |
|---|---|---|
| `createOfferWithAuthorization` (clone + one-signature funding) | 463,632 | 463,656 |
| `createOffer` | 333,960 | 351,060 |
| `open` (clone an account + first deposit) | 620,581 | 625,129 |
| `trade` (rule checks and venue fill) | 212,377 | 212,773 |
| `settle` (the max is a paying settle) | 55,918 | 133,323 |
| `withdraw` | 93,581 | 93,581 |
| `close` | 34,040 | 34,040 |
| `MirrorFeed.push` | 75,459 | 92,703 |

Contract sizes are far below the 24,576-byte limit (largest: `BondlineCover`, 12,957 bytes of runtime code), so
no deployer split was needed.

## 7. Deployment

See [deployments/rhTestnet.json](../deployments/rhTestnet.json) for every address, the deploy block and the
replay schedule. All contracts are verified on the [Robinhood Chain testnet explorer](https://explorer.testnet.chain.robinhood.com).
Covers and accounts are EIP-1167 clones of the verified implementations.

## 8. Limits we know about

- Testnet, unaudited. The keeper prices the testnet feeds (§5); the demo exchange fills at the oracle price.
- One cover pays once. After a settle or close, the user opens a new cover to be covered again.
- Prices for stocks the account holds must all be fresh for a settle. Settlement waits whenever an included price
  exceeds the market's maximum age. These feeds include updates outside NYSE core trading hours.
- The reference price is a simple published model, not actuarial ([PRICING.md](PRICING.md)).
- No protocol fee yet (roadmap), and one bond per offer (pooled underwriting is on the roadmap).
