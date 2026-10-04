# Area 1: money safety

Independent source review and isolated Foundry tests, 4 October 2026. No original source was changed. All builds and proof tests live under `audit/contracts/`; `lib` is a symlink to the existing dependency directory. No transaction was broadcast.

## Proof results

- `FORK_TESTS=false forge test --root audit/contracts --offline --no-match-contract AuditMoneySafetyTest -v`: 168 passed, 4 fork tests skipped; evidence `audit/evidence/baseline-tests.txt`.
- `FORK_TESTS=true forge test --root audit/contracts --offline --no-storage-caching --match-path 'test/fork/*' -v`: all 4 real-USDG/mainnet fork tests passed; evidence `audit/evidence/fork-tests.txt`. These are local fork simulations using read-only public RPC, not transactions on the network.
- `forge test --root audit/contracts --offline --match-contract AuditMoneySafetyTest -vv`: 21 tests, 12 passing controls and 9 deliberately failing safety/assumption assertions, including 1,000 fuzz cases. Exit 1 is expected for those assertions. Evidence `audit/evidence/money-tests.txt`, `money-status.json`; test file `audit/contracts/test/AuditMoneySafety.t.sol`.

Nine failed assertions are not nine independent vulnerabilities. Two expose the disclosed keeper trust boundary, two describe issuer-related health diagnostics, two cover the same dust issue, and the enumeration test uses a stated local gas budget. Every contract finding below has an executed failing test.

## Findings

### High — M01: unsolicited zero-value stock dust can obstruct a payout and cash withdrawal

**Source:** `contracts/src/AgentAccount.sol:225`–valuation loop; `:237`–oldest timestamp; `contracts/src/BondlineCover.sol:309`–fresh valuation; `:316`–freshness condition. Exact function references are `_valuation`, `_freshValuation`, `_isFresh`.

**Failing proof:** `testSafety_claimUnaffectedByDisallowedZeroValueStaleDonation` opens an account whose mask permits TSLA only, makes its TSLA loss settleable with a fresh TSLA feed, then donates one wei of AMZN. Its USDG contribution rounds to zero, yet the stale AMZN timestamp makes `health.settleable` false. `testSafety_cashWithdrawalUnaffectedByZeroValueStaleDonation` proves a cash withdrawal reverts with `StalePrices` after the same zero-value donation.

**Impact:** anyone holding a listed stock token can conditionally block an otherwise eligible claim or cash withdrawal; ending cover with `close` abandons the claim.

**Smallest fix:** stop zero-valued dust from controlling freshness and add a narrowly constrained way for the owner to remove unsolicited/disallowed tokens during active cover, without enabling withdrawal of accounted-for covered assets. Material holdings must still be valued conservatively.

**Limit:** obstruction lasts until the donated stock's feed becomes fresh or cover is closed; this is not permanent seizure of all assets. The recipient's own agent cannot sell AMZN when its mask excludes it, and `sweepToken` is unavailable until release.

### Medium — M02: public historical replay prices expose team venue inventory to predictable profitable trading

**Source:** `contracts/src/BondlineMarket.sol:93`–permissionless `createOffer`; `contracts/src/OracleVenue.sol:113`–registered-account admission; `keeper/data/replay-rounds.json`–published future replay history.

**Failing proof:** `testSafety_untrustedReplayParticipantCannotExtractVenueUSDG` uses a genuine publicly created cover and account, zero fee, a 29.99% limit and 100% stock rule. A small 0.01%-of-principal reservation satisfies the cap/limit arithmetic. It buys at a public historical TSLA price of $346.175 and sells at the later $374.37 price through the honest scheduled feed. Its assertion that venue USDG is preserved fails: fixture profit and venue loss are **63,428.345477 USDG**.

**Impact:** during an open Replay, permissionless participants can use known future prices to capture the team's inventory subsidy.

**Smallest fix:** restrict participation in this historical demo venue, isolate per-participant inventory/allowances, or clearly accept and budget the replay subsidy. A registered account check alone is not an admission limit.

**Limit:** the numeric result uses an 800,000-USDG account and a large funded mock venue; it is not a demonstrated drain of the current deployment. The pinned live Replay venue held **40 USDG and 3.5 TSLA**. Direct EOA calls remain rejected. This does not exceed a cover reservation or forge account membership, and is not a proven live-price arbitrage path.

### Medium — M03: zero-bond offers produce unbounded whole-book enumeration

**Source:** `contracts/src/BondlineMarket.sol:93`, `:157`, `:181`; `keeper/src/settle.ts:77`; `web/src/components/market/data.ts` reads the entire offer list.

**Failing proof:** `testSafety_emptyOfferSpamRemainsEnumerableUnderTwoMillionGas` creates 1,000 unfunded offers and shows `offers()` fails under an explicit 2,000,000-gas call budget. Passing measurement control `testClean_measureEmptyOfferEnumerationCost` measures **7,888,173 gas** for 1,000 offers with cold account access but already-warm storage. Creation in the fixture costs about 307 million gas overall: spam still pays execution costs, and could be spread across transactions.

**Impact:** paid creation of empty offers can make keeper/site whole-book calls increasingly expensive and eventually exceed finite RPC or execution budgets.

**Smallest fix:** paginate enumeration and update callers to process bounded batches; filter inactive/unfunded offers operationally. A minimum bond alone is insufficient if it can immediately be released and the historical list remains unbounded.

**Limit:** 2 million gas is a test budget, not an established Robinhood RPC limit. No outage of the current four-offer deployment was demonstrated. This is a scalability/griefing risk, not proof that individual `settle(account)` is disabled.

### Low — M04: health reports economic eligibility while issuer controls prevent settlement

**Source:** `contracts/src/BondlineCover.sol:251`, `:265`–`health`; `contracts/src/Types.sol:88`–success promise; `:177`–`settle`; `web/src/components/account/AccountActions.tsx:87`–settlement action; `keeper/src/settle.ts:118`–health-driven send.

**Failing proof:** `testSafety_healthRejectsIssuerPausedSettlement` and `testSafety_healthRejectsFrozenPayoutRecipient`: token transfers reject settlement, while `health.settleable` remains true.

**Impact:** UI and keeper can advertise/attempt a payout that currently cannot execute, causing user confusion and repeated failed attempts.

**Smallest fix:** distinguish price/loss eligibility from current payment readiness and check USDG pause/freeze status before offering/sending settlement. Do not promise that a view result guarantees execution.

**Clean behavior:** the failed transfer rolls back settlement status, bond/reserve/claim accounting, `stop` and `release` together. Unpause/unfreeze permits retry. `close` works without a transfer but ends protection. There is no paid-but-unrecorded claim or lost reservation in these tests.

### Low — M05: issuer-blocked trades can revert without a Blocked receipt

**Source:** `contracts/src/AgentAccount.sol:106`, `:128`; `contracts/src/Types.sol:44`; `README.md:55` and related public receipt claims.

**Failing proof:** `testSafety_issuerBlockedTradeStillProducesBlockedReceipt` pauses USDG and submits an otherwise rule-compliant buy. The transfer reverts and no `Blocked` event survives.

**Impact:** the public history omits some failed decisions despite the stated complete-refusal-record guarantee.

**Smallest fix:** qualify the receipt guarantee to completed rule-check refusals, or implement a carefully isolated execution-failure receipt path that preserves atomic accounting. Off-chain holds and never-submitted decisions also cannot be reconstructed from events.

**Limit:** the agent does not move funds outside the permitted trade path. A reverted transaction cannot preserve events from its reverted frame.

## Keeper, venue and settlement trust boundary

Only the immutable keeper may push a MirrorFeed answer; there is no key rotation, owner setter or upgrade route. Positive answers and increasing non-future timestamps are enforced. The source answer and timestamp are not authenticated on-chain.

`testSafety_keeperCannotManufacturePayoutAgainstUnchangedReferencePrice` holds an external reference at $400 and changes only the mirror to $200. Settlement pays **198 USDG** against a **990-USDG** principal, even though the reference value is **989.208 USDG**, and remains within the reservation. `testSafety_oldMirrorAnswerCannotBeRetimestampedAsFresh` proves an old answer can be submitted with a new timestamp. These are deliberately failing assumptions about a trusted keeper, not unauthorized-write findings. They support the wording corrections in C02/C05.

A bad positive fresh price can move value through both venue trading and settlement; extreme answers may make arithmetic/valuation revert until corrected. An absent keeper leaves stock valuations stale and blocks settlement/withdrawal/trading until updates resume. Cash-only valuation remains fresh. Owners can pause the agent or close/release the account; closing abandons the payout. OracleVenue inventory has no admin withdrawal or rescue path: unsolicited inventory or a permanently unusable venue can remain there indefinitely by design.

## Every division in contracts/src

| Source / operation | Rounding | Consequence |
|---|---|---|
| `PriceMath.sol:14`: stock × price / 1e20 | Down | USDG stock valuation is conservative; sub-micro-USDG dust values zero. |
| `PriceMath.sol:19`: USDG × 1e20 / price | Down | Buy's stock quantity does not exceed the oracle amount. |
| `PriceMath.sol:24`: sell amount from USDG target | Up | Stock debit covers the requested target; at most a smallest-stock-unit rounding increment. |
| `OracleVenue.sol:64`, `:74`: conversion then spread / 10000 | Down, twice where conversion already floored | Both fills favor venue solvency. |
| `BondlineCover.sol:166`: principal × remaining value / value | Down | Withdrawal cannot inflate remaining insured principal or claim liability. |
| `BondlineCover.sol:186`, `:267`: principal × cap-minus-limit / 10000 | Down | Payout cap never exceeds reserved worst case. |
| `BondlineCover.sol:277`, `:291`: premium / 10000 | Down | Premium favors depositor; fixed 1-USDG minimum limits deposit dust, but zero-fee offers are permitted. |
| `BondlineCover.sol:324`: loss limit / 10000 | Up | Limit is not rounded against user. |
| `BondlineCover.sol:329`: worst-case reservation / 10000 | Up | Each deposit is conservatively reserved; sum of ceilings can exceed ceiling of total until withdrawal recalculates it. |
| `AgentAccount.sol:335`, `:341`: trade/day amount limits / 10000 | Down | Allows no excess from monetary rounding. |
| `AgentAccount.sol:351`: stock share × 10000 / value | Up | Conservative buy admission, not a continuously enforced holding ceiling. |
| `AgentAccount.sol:378`: shortfall × 10000 / oracle output | Up | Conservative slippage check. |
| `AgentAccount.sol:120`, `:214`: timestamp / day | Down | UTC day bucket, not money rounding. |

These directions do not establish unlimited-input arithmetic safety: fantastically large amounts/prices can revert on checked overflow. The tested monetary bounds and real-token fixture do not show a route that pays more than a position's reservation.

## Checked and found clean

- 1,000 independent fuzz cases of deposit/top-up/proportional withdrawal followed by loss: payout never exceeds the account's reserve and total reserved never exceeds bond.
- Underwriter cannot withdraw reserved bond; withdrawing all free bond and delisting still permits payout to existing accounts.
- Double settlement rejects the second call and transfers no second payout.
- Stale/non-positive/incomplete held prices reject settlement; price checks enforce configured ages and source consistency.
- Agent cannot withdraw, sweep, pay, release or reconfigure active funds; successful rule refusals do not change balances. Only fixed agent trades through the fixed venue; only owner/cover controls have their stated permissions.
- USDG receiveWithAuthorization: caller must be payee; changing sender breaks signature; unsuccessful front-running does not consume the nonce; successful use consumes it and replay fails. The real USDG fork confirms domain separator, one-signature funding and payee enforcement. No signature theft/redirection was reproduced.
- USDG pause/freeze transfer failures preserve all accounting and can retry; close remains available independent of prices/issuer token movement.
- Direct non-account venue callers are rejected; clone implementations disable their own initializers and created clones are initialized atomically.

No Critical finding was proven. No payout above reservation, double payout, or agent withdrawal escape was demonstrated. Historical proof/coverage/mutation reports were inspected separately; they do not cancel the newly reproduced findings.
