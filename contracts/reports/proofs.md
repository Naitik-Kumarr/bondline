# Proofs: BondlineCover

Generated 2026-10-04T07:31:21+05:30 on Apple M5 Pro, forge 1.5.1-stable, solc 0.8.28, halmos 0.3.3, slither-analyzer 0.11.6. Every number below comes from a command listed in this file; the only hand-written judgements are the "equivalent" notes on surviving mutants (made by reading the code) and the statements of what each property means. Machine-readable copy: `proofs.json`.

Everything here runs on the **testnet-deployed source** (`contracts/src`, not modified) against the test mocks `MockUSDG` and `MockStock`. Nothing here sends a transaction.

## Summary

| Workstream | Result |
|---|---|
| Halmos P1: settle never pays more than the cover's reservation for that account | proven within stated bounds; some instances not proven (13 of 18 instances proven, 5 timed out) |
| Halmos P2: loss <= limit: settle reverts WithinLimit(loss, limit) and moves no USDG | proven within stated bounds (6 of 6 instances proven) |
| Halmos P3: loss <= cap: value + payout == principal - limit (limit rounded up) | proven within stated bounds (6 of 6 instances proven) |
| Halmos P4: after every deposit and withdraw: reserve >= principal x (cap - limit) / 10000 | proven within stated bounds (16 of 16 instances proven) |
| Halmos P5: the market keeps no USDG after createOffer and createOfferWithAuthorization | proven for all paths (halmos, within the modelled-signature assumption) (2 of 2 instances proven) |
| Invariants | 8 of 8 hold; 1000 runs x depth 200 = 200,000 calls each |
| Mutation testing | 747 compilable mutants of BondlineCover.sol: 720 killed, 27 survived (all judged equivalent), 0 timed out; 230 more failed to compile and are not counted. The first-pass split before the added tests is not reproducible (see section 3) |

## 1. Halmos symbolic proofs

File: `contracts/test/halmos/BondlineHalmos.t.sol` (contract `BondlineHalmosTest`). The tests deploy the real `BondlineMarket` (which deploys the real `OracleVenue`), real `MirrorFeed`, and create real `BondlineCover` and `AgentAccount` clones through `createOffer` and `open`. Tests are named `check_<property>_<instance>`; each has a twin `check_reach_<property>_<instance>` with identical assumptions that ends in `assert(false)`: halmos reporting a counterexample for the twin is a witness that the interesting branch (the settle payout, the deposit, the offer) is reachable under those assumptions, so a pass of the real check is not vacuous.

### What each property asserts

1. **P1** After `settle`, `payout <= position.reserve` (the account's reservation read before settling); `settle` does not revert (the bond never underflows); `bond` falls by exactly `payout` and `reserved` by exactly the account's reservation; `bond >= reserved` afterwards.
2. **P2** With `loss <= limit` (loss from a loss of cash, from a gain, or from a price move), `settle` reverts with exactly `WithinLimit(loss, limit)` where `loss` and `limit` are recomputed in the test with plain arithmetic (`limit = (principal x limitBps + 9999) / 10000`); the balances of the cover, the account and the user, `bond` and `claimsPaid` are unchanged and the position is still Active.
3. **P3** With `limit < loss` and `loss - limit <= principal x (cap - limit) / 10000`: `payout == loss - limit`, the user receives exactly `payout`, and `value + payout == principal - limit`. The limit is rounded up (`ceil(principal x limitBps / 10000)`), so the user's net loss is the exact limit fraction rounded up to the next unit of USDG (6 decimals); it is never more than the rounded-up limit. The stocks stay in the account (the account's value is unchanged by `settle`).
4. **P4** After the open (first deposit), after every further `deposit`, and after every `withdraw`: `reserve x 10000 >= principal x (cap - limitBps)`, `reserved >= reserve` and `bond >= reserved`.
5. **P5** After `createOffer` (followed by `fund`) and after `createOfferWithAuthorization`, `USDG.balanceOf(market) == 0`; in the authorization case the cover holds exactly the bond.

### Status of each property

Status vocabulary: **proven for all paths** (no bounds on the inputs beyond non-zero amounts), **proven within stated bounds** (for every value of the symbolic inputs inside the bounds), **not proven** (timeout or counterexample, listed).

| Id | Property | Status | Instances proven / total | Paths explored | Solver time, summed over instances (s) |
|---|---|---|---|---|---|
| P1 | settle never pays more than the cover's reservation for that account | proven within stated bounds; 5 of 18 instances not proven (solver timeout) | 13 / 18 | 162 (160 in the verifier's re-run) | 5484 |
| P2 | loss <= limit: settle reverts WithinLimit(loss, limit) and moves no USDG | proven within stated bounds | 6 / 6 | 59 | 190 |
| P3 | loss <= cap: value + payout == principal - limit (limit rounded up) | proven within stated bounds | 6 / 6 | 44 | 827 |
| P4 | after every deposit and withdraw: reserve >= principal x (cap - limit) / 10000 | proven within stated bounds | 16 / 16 | 114 | 1316 |
| P5 | the market keeps no USDG after createOffer and createOfferWithAuthorization | proven for all paths (halmos, within the modelled-signature assumption) | 2 / 2 | 37 | 3 |

Bounds, per property:

- **P1**: Limit: every value in [1, 2999] bps (symbolic) or {1, 500, 777, 1000, 2000, 2999} (concrete, when the principal is symbolic). Deposit: concrete 1,000,000 / 123,456,789 / 1,000,000,000 / 2^50 units (net of a 1% premium), plus a second deposit of 777,777,777; withdrawal: symbolic on a 2^27-unit zero-premium principal, or 1 wei / 20,000,000 units with prior loss 0 or 10,000,000; loss: symbolic, any amount above the limit up to the whole account; bond: symbolic up to 2^80 (p1_single) else 2^80; price-driven cases: real 80% TSLA buy at $400, then any 8-decimal price in [1, 2^40].
- **P2**: Limit: every value in [1, 2999] bps (symbolic). Deposit: concrete 1,000,000 / 123,456,789 / 1,000,000,000 / 2^50 units. Loss and gift (value above principal): symbolic, up to the account balance and 2^64; price-driven cases: any 8-decimal price in [1, 2^40] after a real TSLA buy.
- **P3**: Limit: every value in [1, 2999] bps (symbolic). Deposit: concrete 1,000,000 / 123,456,789 / 1,000,000,000 / 2^50 units. Loss: symbolic, any value with limit < loss and loss - limit <= principal x (cap - limit) / 10000. Price-driven: real TSLA position, any price in [1, 2^40].
- **P4**: Deposit: limit symbolic over [1, 2999] with first deposit concrete (1,000,000 / 123,456,789 / 1,000,000,000 / 2^50 units) and a second deposit of 777,777,777; withdraw: symbolic amount on a 2^27-unit zero-premium principal with limit in {1, 500, 777, 1000, 2000, 2999}, or concrete amount (1 wei, 20,000,000) after a concrete prior loss (0, 10,000,000, 100,000,000) with the limit symbolic over [1, 2999].
- **P5**: All paths: underwriter, agent, every numeric term (min/max limit, fee, max stock share) and the bond amount (any non-zero amount the mock USDG can mint to the underwriter) are symbolic; the underwriter is assumed not to be the zero address, the market or the USDG contract; the authorization signature (v, r, s), nonce and validBefore are symbolic and assumed valid by constraining ecrecover to return the underwriter.

Common bounds: the offer used accepts limits in [1, 2999] bps (the market requires the maximum limit to stay below the 30% cap); the premium is 1% except in the zero-premium 2^27-unit instances; every deposit is at least `MIN_DEPOSIT` (1 USDG); a deposit never exceeds 2^64 units (about 1.8e13 USDG, far above USDG's supply); the bond is 2^80 units unless stated.

### Why some inputs are concrete (read this)

Halmos 0.3.3 abstracts a product of two symbolic values, and a division by a symbolic value, as uninterpreted functions. `BondlineCover` multiplies the principal by the limit and divides by 10,000 everywhere, and Solidity's checked arithmetic divides by the operand to detect overflow. With the principal and the limit both symbolic the solver cannot decide the properties (the first attempt, with everything symbolic and OpenZeppelin's own `mulDiv`, timed out at 623 seconds on P2). So each instance fixes either the **deposit** (a concrete principal, with the limit, the losses, the gains and the prices symbolic) or the **limit** (with the principal symbolic), and the results are "for all values of the symbolic inputs, at these concrete values". The concrete deposits are 1,000,000 (1 USDG, the minimum), 123,456,789 (an odd amount, so the premium and the rounding leave remainders), 1,000,000,000 and 2^50 units. The deposits 1,000,000 and 1,000,000,000 give principals (990,000 and 990,000,000) divisible by 10,000, so they exercise no rounding; the rounding properties rest on the 123,456,789 and 2^50 instances. The concrete limits are 1, 500, 777, 1000, 2000 and 2999 bps.

Attempts with the principal symbolic as well (limit fixed at 1000 bps, deposit any value in [1e6, 2^64]):

- `check_attempt_p2_within_limit_symbolic_deposit`: not proven (timeout after 913s) (14 paths, 913 s)
- `check_attempt_p3_cash_symbolic_deposit`: not proven (timeout after 908s) (12 paths, 908 s)

### The two modelling choices

1. **`Math.mulDiv`.** The OpenZeppelin `mulDiv` that `BondlineCover` and `AgentAccount` call computes a 512-bit product with `mulmod` and has a long modular-inverse branch for products above 2^256. Halmos cannot prove that branch unreachable for bounded inputs (it treats `mulmod` as uninterpreted), so it explores it on spurious paths and the solver queries time out (the first attempt, unmodified library and everything symbolic, timed out at 623 s on P2). The halmos build therefore swaps OpenZeppelin's `Math.sol` for `test/halmos/HalmosMath.sol`, a copy whose only change is `mulDiv(x, y, d) = x * y / d` (unchecked; division by zero still reverts) and the matching ceiling remainder. This is exact whenever `x * y < 2^256`; every instance bounds its inputs so that holds (every product in these tests is below 2^128). `test/halmos/MathModel.t.sol` fuzzes the closed form against the real OpenZeppelin function under the default build (`FOUNDRY_FUZZ_RUNS=100000`, all 4 tests pass), for the floor and ceiling variants and for the divisors the contracts use. The swap is done by a remapping in `test/halmos/foundry.halmos.toml`, so `foundry.toml` and the deployed source are untouched. The proofs are therefore proofs about the contract code with `mulDiv` taken as its mathematical definition.
2. **Loss.** In the "cash" instances the loss is created by moving USDG out of the account (`vm.prank(account); usdg.transfer(venue, x)`), which stands in for a losing trade; `settle`, `withdraw`, `deposit`, the valuation and the clone code all run for real. In the "stock" instances the loss is real: the agent buys TSLA through `AgentAccount.trade` and the venue, and the feed then moves to a symbolic price (`MirrorFeed.push`), so the valuation reads the real feed. P5's signature: `receiveWithAuthorization` is the real mock, but the signature is not a real one: halmos models `ecrecover` as an uninterpreted function and the test constrains it to return the underwriter (v in {27, 28}, s in the lower half), which is what a valid signature does. Whether the typed-data digest and key are right is covered by the unit tests with real signatures (`BondlineMarket.t.sol`), not by this proof.

### Proof sanity: injected bugs make the proofs fail

Each property was re-run against a scratch copy of the contracts with one bug injected; every one produced a counterexample, so the proofs can fail. (Run in scratch copies; the source was not modified.)

| Property | Injected bug | Test | Result |
|---|---|---|---|
| P1 | settle's cap term becomes principal x (cap - limit) / 10000 + 1 | `check_p1_single_d1e9` | FAIL (counterexample: limit 0xae bps, loss 0x31b3dc40, bond 0x10146cb0), 9 paths, 11.4 s |
| P2 | `loss <= limit` becomes `loss < limit` in settle | `check_p2_within_limit_d123456789` | FAIL (counterexample: limit 0x800 bps, loss 0x17df1c8, gift 0), 11 paths, 14.7 s |
| P3 | _limit rounds down instead of up | `check_p3_cash_d123456789` | FAIL (counterexample: limit 0x800 bps, loss 0x2000000), 7 paths, 10.3 s |
| P4 | _worstCase rounds down instead of up | `check_p4_deposit_d123456789` | FAIL (counterexample: limit 0x800 bps), 8 paths, 50.9 s |
| P5 | createOfferWithAuthorization no longer forwards the bond to the cover (fund call removed) | `check_p5_createOfferWithAuthorization` | FAIL (counterexample found), 22 paths, 0.9 s |

Note: the first P3 and P4 sanity runs used the deposit 1,000,000, whose principal is divisible by 10,000, and passed under the rounding bugs, as expected; the table shows the runs at 123,456,789.

### Not proven and counterexamples

| Test | Result | Paths | Seconds |
|---|---|---|---|
| `check_p1_after_withdraw_pow2_l1000` | TIMEOUT (solver limit 900 s per query) | 9 | 904 |
| `check_p1_after_withdraw_pow2_l2000` | TIMEOUT (solver limit 900 s per query) | 9 | 903 |
| `check_p1_after_withdraw_pow2_l2999` | TIMEOUT (solver limit 900 s per query) | 9 | 901 |
| `check_p1_after_withdraw_pow2_l500` | TIMEOUT (solver limit 900 s per query) | 9 | 902 |
| `check_p1_after_withdraw_pow2_l777` | TIMEOUT (solver limit 900 s per query) | 9 | 902 |

No counterexample was found for any property: every non-passing instance above is a solver timeout, i.e. **not proven**, not a failure. The same properties are proven for the neighbouring instances (see the table of instances below), and P1 after a withdrawal is covered for all limits by the `p1_after_withdraw_fixed_*` instances.

### Every instance

| Property | Test | Status | Paths | Seconds | Reachability witness |
|---|---|---|---|---|---|
| P1 | `p1_after_withdraw_fixed_x0_w20` | PASS | 9 | 19.9 | yes |
| P1 | `p1_after_withdraw_fixed_x10_w20` | PASS | 9 | 13.2 | yes |
| P1 | `p1_after_withdraw_pow2_l1` | PASS | 9 | 36.0 | yes |
| P1 | `p1_after_withdraw_pow2_l1000` | TIMEOUT | 9 | 903.5 | yes |
| P1 | `p1_after_withdraw_pow2_l2000` | TIMEOUT | 9 | 903.3 | yes |
| P1 | `p1_after_withdraw_pow2_l2999` | TIMEOUT | 9 | 901.4 | yes |
| P1 | `p1_after_withdraw_pow2_l500` | TIMEOUT | 9 | 901.6 | yes |
| P1 | `p1_after_withdraw_pow2_l777` | TIMEOUT | 9 | 901.5 | yes |
| P1 | `p1_single_d123456789` | PASS | 9 | 19.4 | yes |
| P1 | `p1_single_d1e6` | PASS | 9 | 19.0 | yes |
| P1 | `p1_single_d1e9` | PASS | 9 | 14.8 | yes |
| P1 | `p1_single_d2p50` | PASS | 9 | 38.5 | yes |
| P1 | `p1_stock_d1e6` | PASS | 8 | 17.2 | yes |
| P1 | `p1_stock_d1e9` | PASS | 8 | 21.3 | yes |
| P1 | `p1_two_deposits_d123456789` | PASS | 9 | 156.8 | yes |
| P1 | `p1_two_deposits_d1e6` | PASS | 9 | 159.5 | yes |
| P1 | `p1_two_deposits_d1e9` | PASS | 9 | 178.7 | yes |
| P1 | `p1_two_deposits_d2p50` | PASS | 11 | 278.5 | yes |
| P2 | `p2_stock_d1e6` | PASS | 11 | 22.0 | yes |
| P2 | `p2_stock_d1e9` | PASS | 11 | 36.8 | yes |
| P2 | `p2_within_limit_d123456789` | PASS | 9 | 27.5 | yes |
| P2 | `p2_within_limit_d1e6` | PASS | 9 | 21.9 | yes |
| P2 | `p2_within_limit_d1e9` | PASS | 9 | 26.7 | yes |
| P2 | `p2_within_limit_d2p50` | PASS | 10 | 54.8 | yes |
| P3 | `p3_cash_d123456789` | PASS | 7 | 78.7 | yes |
| P3 | `p3_cash_d1e6` | PASS | 7 | 60.6 | yes |
| P3 | `p3_cash_d1e9` | PASS | 7 | 112.2 | yes |
| P3 | `p3_cash_d2p50` | PASS | 7 | 230.3 | yes |
| P3 | `p3_stock_d1e6` | PASS | 8 | 107.5 | yes |
| P3 | `p3_stock_d1e9` | PASS | 8 | 237.8 | yes |
| P4 | `p4_deposit_d123456789` | PASS | 9 | 85.3 | yes |
| P4 | `p4_deposit_d1e6` | PASS | 9 | 93.0 | yes |
| P4 | `p4_deposit_d1e9` | PASS | 9 | 91.4 | yes |
| P4 | `p4_deposit_d2p50` | PASS | 9 | 112.0 | yes |
| P4 | `p4_withdraw_fixed_x0_w1wei` | PASS | 7 | 32.9 | yes |
| P4 | `p4_withdraw_fixed_x0_w20` | PASS | 7 | 33.4 | yes |
| P4 | `p4_withdraw_fixed_x100_w1wei` | PASS | 7 | 35.9 | yes |
| P4 | `p4_withdraw_fixed_x100_w20` | PASS | 7 | 36.6 | yes |
| P4 | `p4_withdraw_fixed_x10_w1wei` | PASS | 7 | 33.1 | yes |
| P4 | `p4_withdraw_fixed_x10_w20` | PASS | 7 | 35.8 | yes |
| P4 | `p4_withdraw_pow2_l1` | PASS | 6 | 258.8 | yes |
| P4 | `p4_withdraw_pow2_l1000` | PASS | 6 | 68.8 | yes |
| P4 | `p4_withdraw_pow2_l2000` | PASS | 6 | 98.4 | yes |
| P4 | `p4_withdraw_pow2_l2999` | PASS | 6 | 10.7 | yes |
| P4 | `p4_withdraw_pow2_l500` | PASS | 6 | 190.7 | yes |
| P4 | `p4_withdraw_pow2_l777` | PASS | 6 | 99.1 | yes |
| P5 | `p5_createOffer` | PASS | 15 | 1.1 | yes |
| P5 | `p5_createOfferWithAuthorization` | PASS | 22 | 1.7 | yes |

### Commands

One test (what produced each row above):

```
FOUNDRY_CONFIG=test/halmos/foundry.halmos.toml FOUNDRY_OUT=out-a FOUNDRY_CACHE_PATH=cache-a ../.venv/bin/halmos --root . --contract BondlineHalmosTest --function <test> --forge-build-out out-a --solver yices --solver-timeout-branching 2s --solver-timeout-assertion 900s --no-status
```

All tests, 10 in parallel (took about 40 minutes of wall time):

```
cd contracts && PAR=10 ATO=900s bash test/halmos/run.sh <outdir> '^check_'   # one halmos process per check_* test
```

Each test is a separate `halmos` process; `<outdir>/<test>.log` holds its output (`[PASS]`, `[FAIL]` with the counterexample, or `[TIMEOUT]`, plus paths and time). The tests build with `FOUNDRY_CONFIG=test/halmos/foundry.halmos.toml` so the `mulDiv` model is in the build; `run.sh` sets this. Differential test of the model: `cd contracts && FOUNDRY_FUZZ_RUNS=100000 forge test --match-contract MathModelTest`.

## 2. Invariant runs past 25,000 calls

Command (foundry.toml not edited; its defaults are 256 runs x depth 64 = 16,384 calls):

```
cd contracts && FOUNDRY_OUT=out-a FOUNDRY_CACHE_PATH=cache-a FOUNDRY_INVARIANT_RUNS=1000 FOUNDRY_INVARIANT_DEPTH=200 FOUNDRY_INVARIANT_SHOW_METRICS=true forge test --match-path test/invariant/BondlineInvariants.t.sol -vv
```

| Invariant | Runs | Depth | Calls | Reverts | Result |
|---|---|---|---|---|---|
| `invariant_agentHoldsNothing` | 1000 | 200 | 200,000 | 0 | pass |
| `invariant_coverHoldsItsBond` | 1000 | 200 | 200,000 | 0 | pass |
| `invariant_marketHoldsNoUsdg` | 1000 | 200 | 200,000 | 0 | pass |
| `invariant_noPayoutExceedsReservation` | 1000 | 200 | 200,000 | 0 | pass |
| `invariant_onlyMarketCoversAreOffers` | 1000 | 200 | 200,000 | 0 | pass |
| `invariant_reservationCoversWorstCase` | 1000 | 200 | 200,000 | 0 | pass |
| `invariant_reservedIsSumOfReservations` | 1000 | 200 | 200,000 | 0 | pass |
| `invariant_reservedNeverExceedsBond` | 1000 | 200 | 200,000 | 0 | pass |

The 8 invariants share one handler (`Handler` in `BondlineInvariants.t.sol`), so they see the same call sequence. Calls per handler function, from forge's metrics table (identical for every invariant):

| Handler function | Calls | Reverts | Discards |
|---|---|---|---|
| `close` | 18,260 | 0 | 0 |
| `createOffer` | 18,290 | 0 | 0 |
| `delist` | 18,260 | 0 | 0 |
| `deposit` | 18,006 | 0 | 0 |
| `fund` | 18,016 | 0 | 0 |
| `movePrices` | 18,219 | 0 | 0 |
| `open` | 18,264 | 0 | 0 |
| `release` | 17,950 | 0 | 0 |
| `settle` | 18,405 | 0 | 0 |
| `trade` | 17,920 | 0 | 0 |
| `withdraw` | 18,410 | 0 | 0 |

Caveat: forge counts a handler call even when the handler returns at once because its precondition does not hold (it pre-checks before acting, which is why forge-level reverts are 0). The table is the number of calls made, not the number of state changes.

## 3. Mutation testing of BondlineCover.sol

Tool: `slither-mutate` (slither-analyzer 0.11.6) on a scratch copy of `contracts/` (nothing under `/Users/naitik/surety` was mutated), all 15 slither mutators, `--comprehensive`. Test command per mutant: `forge test --no-match-path 'test/fork/*' --fail-fast` (the whole non-fork suite, which includes the cover, market, account, venue, feed, USDG-domain, invariant and, in the second pass, `CoverMutationTest` suites). A mutant is killed if any test fails.

| | Count |
|---|---|
| Mutants generated | 977 |
| Did not compile (not counted) | 230 |
| **Total tested** | **747** |
| Killed by the existing suites (first pass) | 689 in the builder's run; not reproducible (691 and 693 implied by the verifier's re-runs of the 58) |
| Survived the existing suites | 58 in the builder's run; not reproducible (56 and 54) |
| Killed after adding `test/mutation/CoverMutation.t.sol` (20 tests) | **720** |
| **Survived** | **27** |
| **Timed out** | **0** |

The first-pass numbers depend on the test tree: the seeded invariant campaign kills 2 to 4 of the line-189
`reserved` mutants (`%=`, `<<=`, `>>=`) in some trees and not in others (verification/A.json), so they are not a
reproducible result. The final split below (720 killed, 27 survived, 0 timed out) reproduced exactly in the verifier's full re-run.

Per mutator (first pass, builder's run, not reproducible): AOR caught 104, uncaught 8; ASOR caught 111, uncaught 9; BOR caught 4; CR compilation failure 87, caught 105, uncaught 2; FHR compilation failure 54; LOR caught 7; MIA caught 104, uncaught 4, compilation failure 2; MVIE compilation failure 6, caught 16; ROR caught 131, uncaught 24, compilation failure 25; RR compilation failure 37, caught 87, uncaught 1; SBR uncaught 10, compilation failure 19, caught 20. `LIR` (literal replacement) generated no mutants on this contract, so 9 literal mutants were made by hand (below).

The 58 survivors of the builder's first pass were re-run against the suites plus the new tests (the saved mutant files, same command): 31 were killed, 27 survive. All 27 are judged equivalent by reading the code:

| Line | Mutation | Why it survives |
|---|---|---|
| 29 | `uint256 private constant BPS = 10_000;  ==>  uint128 private constant BPS = 10_000;` | Equivalent: the narrower type still holds the value (10_000 and 1e6 fit in uint128); no behaviour change. |
| 29 | `uint256 private constant BPS = 10_000;  ==>  uint256 private immutable BPS = 10_000;` | Equivalent: constant -> immutable keeps the value and the getter; only deployment gas differs. |
| 32 | `uint256 public constant MIN_DEPOSIT = 1e6;  ==>  uint128 public constant MIN_DEPOSIT = 1e6;` | Equivalent: the narrower type still holds the value (10_000 and 1e6 fit in uint128); no behaviour change. |
| 32 | `uint256 public constant MIN_DEPOSIT = 1e6;  ==>  uint256 public immutable MIN_DEPOSIT = 1e6;` | Equivalent: constant -> immutable keeps the value and the getter; only deployment gas differs. |
| 34 | `uint16 public constant MAX_SLIPPAGE_BPS = 500;  ==>  uint16 public immutable MAX_SLIPPAGE_BPS = 500;` | Equivalent: constant -> immutable keeps the value and the getter; only deployment gas differs. |
| 36 | `uint32 public constant MAX_DAILY_BPS = 100_000;  ==>  uint32 public immutable MAX_DAILY_BPS = 100_000;` | Equivalent: constant -> immutable keeps the value and the getter; only deployment gas differs. |
| 65 | `Position storage pos = _positions[account];  ==>  Position memory pos = _positions[account];` | Equivalent: the pointer is only read, never written through, so storage vs memory returns the same values. |
| 66 | `if (pos.status == CoverStatus.None) revert UnknownAccount(account);  ==>  if (pos.status <= CoverStatus.None) revert UnknownAccount(account);` | Equivalent: None is 0, the smallest enum value, so <= None is == None. |
| 95 | `if (amount == 0) revert ZeroAmount();  ==>  if (amount <= 0) revert ZeroAmount();` | Equivalent: the operand is unsigned, so <= 0 is == 0. |
| 105 | `if (amount == 0) revert ZeroAmount();  ==>  if (amount <= 0) revert ZeroAmount();` | Equivalent: the operand is unsigned, so <= 0 is == 0. |
| 130 | `Terms storage t = _terms;  ==>  Terms memory t = _terms;` | Equivalent: the pointer is only read, never written through, so storage vs memory returns the same values. |
| 160 | `if (pos.status != CoverStatus.Active) revert NotActive(account);  ==>  if (pos.status > CoverStatus.Active) revert NotActive(account);` | Equivalent: differs only for status None, which the preceding UnknownAccount check (or onlyUser) has already rejected on this path. |
| 161 | `if (amount == 0) revert ZeroAmount();  ==>  if (amount <= 0) revert ZeroAmount();` | Equivalent: the operand is unsigned, so <= 0 is == 0. |
| 179 | `if (pos.status == CoverStatus.None) revert UnknownAccount(account);  ==>  if (pos.status <= CoverStatus.None) revert UnknownAccount(account);` | Equivalent: None is 0, the smallest enum value, so <= None is == None. |
| 180 | `if (pos.status != CoverStatus.Active) revert NotActive(account);  ==>  if (pos.status > CoverStatus.Active) revert NotActive(account);` | Equivalent: differs only for status None, which the preceding UnknownAccount check (or onlyUser) has already rejected on this path. |
| 204 | `if (pos.status != CoverStatus.Active) revert NotActive(account);  ==>  if (pos.status > CoverStatus.Active) revert NotActive(account);` | Equivalent: differs only for status None, which the preceding UnknownAccount check (or onlyUser) has already rejected on this path. |
| 252 | `Position memory pos = _positions[account];  ==>  Position storage pos = _positions[account];` | Equivalent: the pointer is only read, never written through, so storage vs memory returns the same values. |
| 257 | `if (pos.status == CoverStatus.None) return h;  ==>  if (pos.status <= CoverStatus.None) return h;` | Equivalent: None is 0, the smallest enum value, so <= None is == None. |
| 265 | `if (pos.status == CoverStatus.Active && h.fresh && h.loss > h.limit) {  ==>  if (pos.status <= CoverStatus.Active && h.fresh && h.loss > h.limit && h.fresh && h.loss > h.limit) {` | Equivalent: differs only for status None, for which health() has already returned (line 257). |
| 286 | `if (pos.status == CoverStatus.None) revert UnknownAccount(account);  ==>  if (pos.status <= CoverStatus.None) revert UnknownAccount(account);` | Equivalent: None is 0, the smallest enum value, so <= None is == None. |
| 287 | `if (pos.status != CoverStatus.Active) revert NotActive(account);  ==>  if (pos.status > CoverStatus.Active) revert NotActive(account);` | Equivalent: differs only for status None, which the preceding UnknownAccount check (or onlyUser) has already rejected on this path. |
| 318 | `if (v.oldestUpdate == 0) return v.stockValue == 0;  ==>  if (v.oldestUpdate <= 0) return v.stockValue == 0;` | Equivalent: the operand is unsigned, so <= 0 is == 0. |
| 333 | `if (r.assetMask == 0 \|\| uint256(r.assetMask) >= (1 << assetCount)) return false;  ==>  if (r.assetMask <= 0 \|\| uint256(r.assetMask) >= (1 << assetCount) \|\| uint256(r.assetMask) >= (1 << assetCount)) return false;` | Equivalent: the operand is unsigned, so <= 0 is == 0. |
| 333 | `if (r.assetMask == 0 \|\| uint256(r.assetMask) >= (1 << assetCount)) return false;  ==>  if (r.assetMask == 0 \|\| uint128(r.assetMask) >= (1 << assetCount)) return false;` | Equivalent: widening a uint8 mask before the comparison changes nothing. |
| 335 | `if (r.maxTradeBps == 0 \|\| r.maxTradeBps > BPS) return false;  ==>  if (r.maxTradeBps <= 0 \|\| r.maxTradeBps > BPS \|\| r.maxTradeBps > BPS) return false;` | Equivalent: the operand is unsigned, so <= 0 is == 0. |
| 336 | `if (r.maxDailyBps == 0 \|\| r.maxDailyBps > MAX_DAILY_BPS) return false;  ==>  if (r.maxDailyBps <= 0 \|\| r.maxDailyBps > MAX_DAILY_BPS \|\| r.maxDailyBps > MAX_DAILY_BPS) return false;` | Equivalent: the operand is unsigned, so <= 0 is == 0. |
| 338 | `if (r.maxPriceAge == 0 \|\| r.maxPriceAge > maxPriceAge) return false;  ==>  if (r.maxPriceAge <= 0 \|\| r.maxPriceAge > maxPriceAge \|\| r.maxPriceAge > maxPriceAge) return false;` | Equivalent: the operand is unsigned, so <= 0 is == 0. |

Slither's ROR text replacement on lines with two comparisons (333, 335, 336, 338, 265) appends the other clause again, which is logically a no-op; the table shows the first line of the mutated text.

### Killed by the new tests

| Line | Mutation | First failing test |
|---|---|---|
| 116 | `if (!listed) return;  ==>  if (false) return;` | `test_delist_secondCallEmitsNothing` |
| 118 | `emit Delisted();  ==>  //emit Delisted();` | `test_delist_secondCallEmitsNothing` |
| 126 | `nonReentrant  ==>  //nonReentrant` | `test_open_isNonReentrant` |
| 129 | `if (!listed) revert NotListed();  ==>  if (false) revert NotListed();` | `test_open_delistedRefusesBeforeValidatingArguments` |
| 184 | `uint256 loss = pos.principal > v.value ? pos.principal - v.value : 0;  ==>  uint256 loss = true ? pos.principal - v.value : 0;` | `test_health_gainHasZeroLoss` |
| 185 | `if (loss <= limit) revert WithinLimit(loss, limit);  ==>  if (loss < limit) revert WithinLimit(loss, limit);` | `test_settle_exactlyAtLimitReverts_oneWeiOverPaysOneWei` |
| 189 | `reserved -= pos.reserve;  ==>  reserved %= pos.reserve;` | `test_health_settledAndClosedAccountsAreNotSettleable` |
| 189 | `reserved -= pos.reserve;  ==>  reserved %= pos.reserve;` | `test_health_settledAndClosedAccountsAreNotSettleable` |
| 189 | `reserved -= pos.reserve;  ==>  reserved <<= pos.reserve;` | `test_health_settledAndClosedAccountsAreNotSettleable` |
| 189 | `reserved -= pos.reserve;  ==>  reserved >>= pos.reserve;` | `test_health_settledAndClosedAccountsAreNotSettleable` |
| 192 | `claimsPaid += payout;  ==>  claimsPaid = payout;` | `test_counters_accumulateAcrossDepositsAndSettlements` |
| 192 | `claimsPaid += payout;  ==>  claimsPaid ^= payout;` | `test_counters_accumulateAcrossDepositsAndSettlements` |
| 192 | `claimsPaid += payout;  ==>  claimsPaid \|= payout;` | `test_counters_accumulateAcrossDepositsAndSettlements` |
| 264 | `h.loss = pos.principal > v.value ? pos.principal - v.value : 0;  ==>  h.loss = pos.principal > v.value ? pos.principal % v.value : 0;` | `test_health_lossAndPayoutNow` |
| 265 | `if (pos.status == CoverStatus.Active && h.fresh && h.loss > h.limit) {  ==>  if (pos.status == CoverStatus.Active && h.fresh && pos.status == CoverStatus.Active && h.fresh && h.loss >= h.limit) {` | `test_settle_exactlyAtLimitReverts_oneWeiOverPaysOneWei` |
| 265 | `if (pos.status == CoverStatus.Active && h.fresh && h.loss > h.limit) {  ==>  if (pos.status >= CoverStatus.Active && h.fresh && h.loss > h.limit && h.fresh && h.loss > h.limit) {` | `test_health_settledAndClosedAccountsAreNotSettleable` |
| 267 | `h.payoutNow = Math.min(h.loss - h.limit, pos.principal * (capBps - pos.limitBps) / BPS);  ==>  h.payoutNow = Math.min(h.loss - h.limit, pos.principal * (capBps - pos.limitBps) * BPS);` | `test_health_lossAndPayoutNow` |
| 267 | `h.payoutNow = Math.min(h.loss - h.limit, pos.principal * (capBps - pos.limitBps) / BPS);  ==>  h.payoutNow = Math.min(h.loss - h.limit, pos.principal * (capBps - pos.limitBps) + BPS);` | `test_health_lossAndPayoutNow` |
| 267 | `h.payoutNow = Math.min(h.loss - h.limit, pos.principal * (capBps - pos.limitBps) / BPS);  ==>  h.payoutNow = Math.min(h.loss - h.limit, pos.principal * (capBps - pos.limitBps) - BPS);` | `test_health_lossAndPayoutNow` |
| 267 | `h.payoutNow = Math.min(h.loss - h.limit, pos.principal * (capBps - pos.limitBps) / BPS);  ==>  h.payoutNow = Math.min(h.loss - h.limit, pos.principal + (capBps - pos.limitBps) / BPS);` | `test_health_lossAndPayoutNow` |
| 267 | `h.payoutNow = Math.min(h.loss - h.limit, pos.principal * (capBps - pos.limitBps) / BPS);  ==>  h.payoutNow = Math.min(h.loss - h.limit, pos.principal - (capBps - pos.limitBps) / BPS);` | `test_health_lossAndPayoutNow` |
| 297 | `premiums += fee;  ==>  premiums = fee;` | `test_counters_accumulateAcrossDepositsAndSettlements` |
| 297 | `premiums += fee;  ==>  premiums ^= fee;` | `test_counters_accumulateAcrossDepositsAndSettlements` |
| 297 | `premiums += fee;  ==>  premiums \|= fee;` | `test_counters_accumulateAcrossDepositsAndSettlements` |
| 298 | `uint256 available = bond - reserved;  ==>  uint256 available = bond + reserved;` | `test_deposit_refusedWhenFreeBondTooSmall_withReservedBond` |
| 299 | `if (reserveAdded > available) revert InsufficientCapacity(reserveAdded, available);  ==>  if (reserveAdded >= available) revert InsufficientCapacity(reserveAdded, available);` | `test_open_capacityExactlyEnough_andOneBelow` |
| 317 | `if (!v.pricesValid) return false;  ==>  if (!v.pricesValid) revert();` | `test_health_invalidPriceIsNotFresh_andDoesNotRevert` |
| 317 | `if (!v.pricesValid) return false;  ==>  if (false) return false;` | `test_health_invalidPriceIsNotFresh_andDoesNotRevert` |
| 333 | `if (r.assetMask == 0 \|\| uint256(r.assetMask) >= (1 << assetCount)) return false;  ==>  if (r.assetMask == 0 \|\| r.assetMask == 0 \|\| uint256(r.assetMask) == (1 << assetCount)) return false;` | `test_open_assetMaskAboveRangeRejected` |
| 337 | `if (r.maxSlippageBps > MAX_SLIPPAGE_BPS) return false;  ==>  if (r.maxSlippageBps >= MAX_SLIPPAGE_BPS) return false;` | `test_open_slippageBoundary` |
| 338 | `if (r.maxPriceAge == 0 \|\| r.maxPriceAge > maxPriceAge) return false;  ==>  if (r.maxPriceAge == 0 \|\| r.maxPriceAge == 0 \|\| r.maxPriceAge != maxPriceAge) return false;` | `test_open_priceAgeBoundary` |

### Hand-made literal mutants (not counted above)

| Line | Mutation | Result | First failing test |
|---|---|---|---|
| 29 | `uint256 private constant BPS = 10_000;` -> `uint256 private constant BPS = 10_001;` | killed | `test_counters_accumulateAcrossDepositsAndSettlements` |
| 29 | `uint256 private constant BPS = 10_000;` -> `uint256 private constant BPS = 9_999;` | killed | `test_close_keepsOtherAccountsReservation` |
| 32 | `MIN_DEPOSIT = 1e6;` -> `MIN_DEPOSIT = 1e6 + 1;` | killed | `test_deposit_tooSmall` |
| 32 | `MIN_DEPOSIT = 1e6;` -> `MIN_DEPOSIT = 1e6 - 1;` | killed | `test_deposit_tooSmall` |
| 34 | `MAX_SLIPPAGE_BPS = 500;` -> `MAX_SLIPPAGE_BPS = 501;` | killed | `test_open_invalidRules` |
| 34 | `MAX_SLIPPAGE_BPS = 500;` -> `MAX_SLIPPAGE_BPS = 499;` | killed | `test_open_slippageBoundary` |
| 36 | `MAX_DAILY_BPS = 100_000;` -> `MAX_DAILY_BPS = 100_001;` | killed | `test_open_tradeAndDailyBoundaries` |
| 36 | `MAX_DAILY_BPS = 100_000;` -> `MAX_DAILY_BPS = 99_999;` | killed | `setUp` |
| 184 | `pos.principal > v.value ? pos.principal - v.value : 0;` -> `pos.principal > v.value ? pos.principal - v.value : 1;` | killed | `test_health_gainHasZeroLoss` |

### Command

```
slither-mutate . --test-cmd "forge test --no-match-path 'test/fork/*' --fail-fast" --contract-names BondlineCover --mutators-to-run <MUTATORS> --comprehensive --timeout 180 --output-dir <dir> -v   (run in a scratch copy of contracts/; mutators split over 7 copies: ROR | AOR,UOR | LIR | MIA | SBR | CR,RR | ASOR,BOR,LOR,FHR,MVIE,MVIV,MWA)
```

The first pass ran as seven parallel scratch copies, one mutator group each; the survivors were re-run with `forge test --no-match-path 'test/fork/*' --fail-fast` after copying each saved mutant over `src/BondlineCover.sol` in a scratch copy that includes `test/mutation/`. The first pass ran on a scratch copy of the test tree without `test/ProofOfCover.t.sol` (another workstream's file, in progress at the time); the second pass and the numbers in section 2 and the full-suite run were made in the real tree.

## 4. Files added

- `contracts/test/halmos/BondlineHalmos.t.sol`: the halmos properties and instances.
- `contracts/test/halmos/HalmosMath.sol`, `contracts/test/halmos/foundry.halmos.toml`: the `mulDiv` model and the build config that selects it.
- `contracts/test/halmos/MathModel.t.sol`: differential fuzz of the model against OpenZeppelin.
- `contracts/test/halmos/run.sh`: runs the halmos instances in parallel.
- `contracts/test/mutation/CoverMutation.t.sol`: 20 tests that kill mutants the earlier suites missed.
- `contracts/reports/proofs.md`, `contracts/reports/proofs.json`: this report.

Full non-fork suite in the real tree, with these tests: `cd contracts && FOUNDRY_OUT=out-a FOUNDRY_CACHE_PATH=cache-a forge test --no-match-path 'test/fork/*'` gave 166 passed, 0 failed (11 suites; includes `ProofOfCover.t.sol`, another workstream's). With `test/QuoteDeposit.t.sol`, added after verification, it is 168 passed in 12 suites.

## 5. What this does not show

- The halmos results are for the listed bounds and concrete values, not for every principal and limit at once. Instances that timed out are listed as not proven.
- The proofs cover `BondlineCover` and its interaction with the account, venue, market and feed as written; they use mocks for USDG and Stock Tokens, so the real Paxos USDG (pause, freeze, blocklist) is outside them (see `docs/TECHNICAL.md` for that trust assumption and `test/UsdgDomain.t.sol` and the fork tests).
- P5 says the market holds no USDG after its two offer-creating functions; it does not say anything about USDG sent to the market by someone else.
- Mutation testing covers `BondlineCover.sol` only. A mutant that survives is not proof of a bug and a killed mutant is not proof of correctness; the 27 survivors are judged equivalent by reading.
- The invariant runs are randomised (foundry seed fixed in `foundry.toml`); they are not proofs.

## Notes added after the independent verification (verification/A.json)

- Path counts depend on solver timing (halmos prunes branches with a 2 s solver timeout): the verifier's re-run
  explored 160 paths for P1, against 162 above. Only `check_p1_two_deposits_d2p50` differed (9 paths against 11),
  with the same PASS verdict. P2 to P5 matched exactly.
- The verifier's own hand-made mutant outside slither's operator set, `quoteDeposit`'s fee rounded up
  (`fee = (amount * feeBps + BPS - 1) / BPS`, line 277), survived the suite, because `quoteDeposit` was tested only
  with a round amount. `contracts/test/QuoteDeposit.t.sol` (added afterwards) compares the quote with a real deposit
  for random amounts and limits, and fails on that mutant. Its 12 other hand-made mutants were all killed.
- The first-pass split (689 killed, 58 survived) is not reproducible. The verifier re-ran the 58 first-pass
  candidates: in a replica of the builder's first-pass tree the invariant suite also killed 2 of the line-189
  mutants, and with the earlier suites inside the current tree it killed 4, implying 691/56 and 693/54. The final campaign (977
  generated, 230 compile failures, 747 tested, 720 killed, 27 survived, 0 timed out) reproduced exactly, each of the
  27 survivors was re-run, and the verifier's final check also killed all 9 literal mutants.
