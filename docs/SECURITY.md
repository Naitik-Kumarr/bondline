# Bondline security notes

Bondline is a hackathon project on **Robinhood Chain testnet** (chain 46630) with Paxos USDG and Robinhood's testnet
Stock Tokens. It is **unaudited**. Nothing here is a claim that the contracts are safe to hold real funds. A cover is
a capped, fully backed protection bond, not regulated insurance. This page says what is in scope, what you have to
trust, what each contract can and cannot do, what has been checked, and what an independent review found on 4 Oct
2026 (section 6). The money math is in [TECHNICAL.md](TECHNICAL.md); the numbers below come from the files named
next to them.

## 1. Scope

In scope (Solidity 0.8.28, `contracts/src`, deployed and verified on the testnet explorer; addresses in
[deployments/rhTestnet.json](../deployments/rhTestnet.json)):

| Contract | One line |
|---|---|
| `BondlineMarket` | Factory and registry of offers. Two deployed: Live and Replay. |
| `BondlineCover` | One underwriter's bond behind one agent. Premiums, reservations, settle, close. |
| `AgentAccount` | A user's covered account. Enforces the agent's rules. |
| `OracleVenue` | The demo exchange. |
| `MirrorFeed` | A Chainlink-compatible feed pushed by one keeper address. |
| `ProofOfCover` | A read-only lookup: whether an account has active cover, its underwriter, limit and cap, and the cover's free capacity. It does not return the account's reservation. Added after the testnet deploy; see [PROOF_OF_COVER.md](PROOF_OF_COVER.md). |

Out of scope: the web app, the keeper, the agents, the SDK and the MCP server (off-chain code that holds no user
funds except the team-operated wallets in section 2), OpenZeppelin, Foundry, USDG and Robinhood's Stock Tokens.

## 2. What you have to trust

These are the real trust assumptions on testnet. Each is stated on the site too.

1. **Prices on testnet are pushed by our keeper.** Robinhood Chain testnet has no Chainlink stock feeds, so each
   market reads `MirrorFeed`s that one keeper address updates. The Live market's keeper copies Chainlink's TSLA/USD
   and AMZN/USD answers from Robinhood Chain mainnet with their real timestamps; the Replay market's keeper replays
   real mainnet rounds from 28 Sep to 2 Oct 2026 at a faster speed; the scripted gap demo moves the replay feeds by
   script and is labelled everywhere. `MirrorFeed.push` requires a positive answer and a strictly increasing,
   non-future timestamp. It does not authenticate the source answer or timestamp: the keeper can submit an old or
   invented answer with a new timestamp. That authority affects trades, eligibility to settle and payout amounts. The
   keeper cannot move anyone's money directly. On mainnet, markets would read Chainlink directly (the mainnet-fork
   test does this).
2. **Team-operated wallets.** The keeper, the two agents (Careful and Bold, run by Claude Haiku 4.5), the test
   underwriter and the test buyer are wallets we operate. They are listed in `deployment.wallets` and labelled on the
   site. Covers they hold are demonstration covers, not evidence of outside demand. Anyone can call `settle`. The
   keeper attempts settlement while it is running; transaction latency, stale prices and failed transfers can delay it.
3. **The exchange is a demo.** Testnet Stock Tokens have no market, so `OracleVenue` fills Bondline accounts at the
   oracle price less a fixed spread (10 bps on both markets), from inventory the team supplied. The venue accepts
   registered Bondline accounts, but anyone can create an offer and account. This is not an admission barrier against
   trading ahead of the public replay; its team-supplied inventory remains exposed to that arbitrage (M02 in
   section 6).
4. **USDG's issuer.** USDG can be paused and addresses can be frozen by its issuer. The site checks `paused()` and
   `isFrozen(wallet)` before anyone signs; `close` moves no tokens, so a user can always end a cover and stop the
   agent even if USDG is paused. A frozen user cannot receive a payout.
5. **AI output is not trusted.** The agents can only call `trade`, inside rules fixed when the cover opened.
   Submitted trades that complete emit `Traded` or a rule-check `Blocked` receipt with a hash of the submitted
   decision bytes. Off-chain holds and decisions never submitted are absent, and token or RPC failures may produce no
   receipt. The hash verifies the bytes, not that a model produced them. The decision text is in the transaction
   input. Claim letters (`scripts/claim-letters.ts`) are written by a model from numbers the script supplies,
   off-chain; they are explanations, not contracts, and a letter's hash is kept beside it in `deployments/letters/`.

## 3. What each contract can and cannot do

| Contract | Can | Cannot |
|---|---|---|
| `BondlineMarket` | Create offers (clone a cover for the caller as underwriter); create and fund an offer from one USDG signature; list and delist offers. | Hold USDG after a call (an invariant). Change its configuration, move anyone's funds, be upgraded. It has no owner. |
| `BondlineCover` | Take premiums into the bond; reserve each deposit's worst case before selling it; pay `settle` from the bond to the user; `close` at any price. The underwriter can `release` **free** bond only. | Pay more than a deposit's reservation (an invariant). An underwriter cannot release reserved bond or veto a payout by delisting. Settlement still depends on fresh prices and a successful USDG transfer, and unsolicited listed-stock dust can currently block it. It has no owner. |
| `AgentAccount` | Hold the user's USDG and stocks; execute the agent's `trade` if every rule passes; emit `Blocked` receipts for rule-check refusals; let the user pause and resume the agent and sweep after a settle or close. | Let the agent withdraw or hold tokens (an invariant). Let anyone but the cover move money while the cover is active. |
| `OracleVenue` | Fill Bondline accounts at the oracle price less the spread; refuse stale or invalid prices. | Trade with anyone else. Release inventory except through trades. It has no admin. |
| `MirrorFeed` | Store keeper-pushed answers and serve them as `AggregatorV3Interface`. | Accept a non-positive answer or a timestamp that is not newer or is in the future. Be pushed by anyone but the keeper. |
| `ProofOfCover` | Read two markets and one cover and report. | Write, hold funds, be administered (no owner, no setters, two immutables), or revert on any account's return data. It can run out of gas on a hostile account; see section 5. |

Money rules (all in [TECHNICAL.md](TECHNICAL.md) section 2): payout = min(loss - limit, principal x (30% - limit));
every deposit reserves ceil(net x (30% - limit)) of the bond before it is accepted (`InsufficientCapacity`
otherwise); a withdrawal scales the principal by the share of value taken out so it cannot raise a payout; `settle`
requires every held stock's price to be valid and within the market's max price age (25 h on Live, 5 min on Replay).
Anyone can call `settle`. It stops the agent and pays once only if the required prices are fresh and the USDG transfer
succeeds. USDG pause/freeze controls and unsolicited listed-stock dust can block settlement in the current code. The
user can still stop the agent with `pause` or end cover with `close`.
Reentrancy guards use transient storage. Covers and accounts are EIP-1167 clones initialised in the creating
transaction; the implementations disable their initialisers. Bondline's own contracts are not upgradeable and its
markets have no owner. The fixed keeper controls testnet prices, which affect trades and payouts; USDG and Stock
Tokens retain issuer controls and upgrade paths.

## 4. Invariants and tests

All in Foundry under `contracts/test`; raw output in [contracts/reports/tests.txt](../contracts/reports/tests.txt).

- **172 tests pass, 0 fail, 0 skipped** on 4 Oct 2026 with `FORK_TESTS=true forge test` (Foundry 1.5.1-stable): 168
  unit, fuzz and invariant tests (14 of them for `ProofOfCover`, 20 added to kill mutants) plus 4 fork tests (3
  against the real testnet USDG, 1 on a Robinhood Chain mainnet fork).
- **8 invariants** (`test/invariant/BondlineInvariants.t.sol`, 256 runs of depth 64, random sequences of every action):
  `reserved <= bond`; `reserved` equals the sum of reservations; every reservation covers its account's current worst
  case; no payout exceeds its reservation; every cover holds at least its bond; the market holds no USDG; the agent
  holds nothing; only market-created covers are offers.
- **Coverage** ([contracts/reports/coverage.md](../contracts/reports/coverage.md), 4 Oct 2026, every contract in
  `contracts/src`): lines 100% (554/554), statements 99.72% (701/703), branches 98.43% (125/127), functions 100%
  (94/94). `ProofOfCover` alone: 100% of lines (41/41), statements, branches and functions.
- **Slither 0.11.6** on every contract in `contracts/src`, `ProofOfCover` included
  ([contracts/reports/slither.md](../contracts/reports/slither.md), 4 Oct 2026, with the command and a note on each
  finding): 0 High, 0 Medium. Low: calls-loop 4, missing-zero-check 8, reentrancy-benign 2, reentrancy-events 1,
  timestamp 6. Informational: assembly 3 (`ProofOfCover`'s bounded `staticcall` and word reads), low-level-calls 1,
  naming-convention 1.
- **Symbolic proofs** (Halmos 0.3.3 on `BondlineCover`, and `BondlineMarket` for P5,
  [contracts/reports/proofs.md](../contracts/reports/proofs.md), re-run by an independent verifier): five properties. Settle never pays more than the account's reservation (P1);
  within the limit settle reverts and moves no USDG (P2); up to the cap the user's net loss is exactly the limit,
  rounded up (P3); after every deposit and withdraw the reservation covers the worst case (P4); the market keeps no
  USDG (P5). 43 of 48 instances are proven within stated bounds, and 5 P1 instances timed out at 900 s and are not
  proven. Attempts with the deposit symbolic as well timed out (913 s and 908 s), so each P1 to P4 instance fixes
  either the deposit or the limit and leaves the rest symbolic; P5 holds within its assumptions (a valid signature;
  the underwriter is not the zero address, the market or USDG). OpenZeppelin's `mulDiv` is modelled as `x*y/d` there, checked against the
  real one by a 100,000-run fuzz. Each pass has a reachability twin, so none is vacuous, and an injected bug per
  property is caught.
- **Deeper invariant run:** all 8 invariants hold at 1,000 runs x depth 200 = 200,000 handler calls each. Calls
  whose precondition fails return early, so far fewer change state (in the verifier's probe, 196 of 18,405 settle
  calls paid out).
- **Mutation testing** (slither-mutate on `BondlineCover.sol`): 977 mutants generated, 747 compile, 720 killed, 27
  survive and are judged equivalent by reading the code (not proven equivalent). A hand-made mutant outside
  slither's operators (the fee in `quoteDeposit` rounded up) survived the suite; `test/QuoteDeposit.t.sol` now kills
  it.
- **Not done:** no external audit (roadmap milestone 3). A bounded independent review ran on 4 Oct 2026; section 6
  lists its findings and their status.

## 5. Known limits

- Testnet, unaudited, hackathon time. Do not put real value behind any of it.
- The keeper-pushed prices (section 2, item 1) and the demo exchange (item 3) are the largest gaps against a mainnet
  design. Both are visible in the contracts' configuration and labelled on the site.
- One cover pays once. After a settle or close the user opens a new cover.
- A settle needs every held stock's price fresh. On the Live market the max price age is 25 hours, so a long silence
  of a feed can delay a claim until the next round.
- Chainlink posts a round when the price moves about 0.5%. These feeds include updates outside NYSE core trading
  hours. In this historical window (23 Jun to 2 Oct 2026) the longest observed round gaps were 77.8 hours for TSLA
  and 77.1 hours for AMZN, and 14 gaps per feed were longer than the Live market's 25-hour max price age
  ([BACKTEST.md](BACKTEST.md), computed from the rounds). Settlement waits whenever an included price exceeds the
  market's maximum age. So a settle at "the first round past the limit" can overshoot by up to a deviation step even
  without a gap, and by the whole move across a long gap such as a weekend; the bond pays the overshoot up to the cap.
- Unsolicited listed-stock dust, even one wei of a stock the account's rules do not allow, can currently block a
  settle or a cash withdrawal until that stock's price is fresh; `close` ends cover but gives up the claim (M01 in
  section 6).
- A frozen or paused USDG blocks payouts to the frozen address, while `health` can still report the account
  settleable (M04 in section 6); `close` and `pause` still work.
- `ProofOfCover.isCovered` reports state at the call time. A cover can settle or close in the next block, so a
  protocol that relies on it for anything with value should re-check at the moment of use.
- `ProofOfCover.isCovered` calls the account it is asked about, which can be any contract. Bad return data can't make
  it revert, but gas can: an account whose `cover()` loops forever burns the gas forwarded to it (about 1.97M of 2M
  in a verifier's test), and a transaction with a total gas limit of about 60,000 or less runs out. Called from a
  contract with a gas cap, a hostile account burns only the cap. A covered account needs about 41,000 to 47,000 gas in
  such a call, so a contract that calls `isCovered` on an address it doesn't trust should cap the gas with room to
  spare (for example 100,000) and treat a failure as "not covered".
- The reference price is a simple published model, not actuarial ([PRICING.md](PRICING.md)); the backtest is
  hypothetical covers on a short, in-sample window.

## 6. Independent review, 4 Oct 2026

A bounded independent review of the contracts, the live deployment, secrets and the drip, the web app, the public copy
and operations finished on 4 Oct 2026 (final report 15:29 IST): [audit/AUDIT.md](../audit/AUDIT.md). It proved no
Critical finding. It did not reproduce a payout above a cover's reservation, a double settlement, a redirected or
replayed signature, or an agent withdrawal, and it passed all 172 existing tests again (168 plus 4 fork tests). It is
not a certification of every possible state.

Its contract proofs are 21 Foundry tests in
[audit/contracts/test/AuditMoneySafety.t.sol](../audit/contracts/test/AuditMoneySafety.t.sol): 12 pass, and 9 fail on
purpose, each failure showing a finding below (exit 1 is expected). Run them with
`forge test --root audit/contracts --offline --match-contract AuditMoneySafetyTest -vv`. Other proofs are named in
each row; the report has the full commands. Status is as of 4 Oct 2026. "Fixed today (copy)" means the README, the
docs and the site now use the review's replacement wording.

Totals: 0 Critical, 2 High, 7 Medium and 15 Low, plus 3 operational findings (2 Medium, 1 Low). Fixed today: 17
(C01 to C13, S-2, W2, W3, W4). Mitigated today: S-1. Known and planned: M01 to M05, before any mainnet beta
([ROADMAP.md](ROADMAP.md) milestone 1), and W1.

| ID | Severity | Finding | Status | Proof test or command |
|---|---|---|---|---|
| M01 | High | One wei of an unsolicited listed stock, valued at zero, can block an eligible claim or a cash withdrawal while that stock's price is stale. `close` ends cover but gives up the claim. | Known, planned before any mainnet beta (milestone 1) | `testSafety_claimUnaffectedByDisallowedZeroValueStaleDonation`, `testSafety_cashWithdrawalUnaffectedByZeroValueStaleDonation` |
| W1 | High (advisory inventory) | The lockfile has 7 High, 0 Critical dependency advisories. 2 are in production dependencies: PostCSS 8.4.31 nested under Next, and `ws` 8.18.0 under the wallet SDK. The other 5 are development-only (`braces` through the Next ESLint config, with no patched release). No exploit route on the site was shown. | Known, planned: PostCSS >= 8.5.18 and `ws` >= 8.21.0. No dependency changes today. | From `audit/npm/`: `npm audit --package-lock-only --omit=dev --audit-level=high`, and again without `--omit=dev`; `node audit/web-postcss-proof.cjs` |
| M02 | Medium | While a Replay is open, anyone can create an offer and an account and trade ahead of the published replay prices, taking the team's venue inventory. The test's large profit uses a mock venue; the live Replay venue held 40 USDG and 3.5 TSLA at the review's snapshot. | Known, planned before any mainnet beta (milestone 1) | `testSafety_untrustedReplayParticipantCannotExtractVenueUSDG` |
| M03 | Medium | Offers with no bond make reading the whole book (`offers()`) grow without bound: 7,888,173 gas at 1,000 offers in a local test. Creating them costs gas too. | Known, planned before any mainnet beta (milestone 1) | `testSafety_emptyOfferSpamRemainsEnumerableUnderTwoMillionGas`, `testClean_measureEmptyOfferEnumerationCost` |
| S-1 | Medium | Separate server instances each check the same transfer history, so the drip's one-claim-per-wallet and 30 USDG daily limits can be bypassed (mocked proof: 35 USDG sent, one wallet paid twice). | Mitigated today, full fix planned: the drip wallet holds at most one day's budget (30 test USDG; [set at 16:27 IST](https://explorer.testnet.chain.robinhood.com/tx/0x5c72e0476c3c92250056e6d8aac6126336d6d7bf9e74ca5f412095be7a986942)), so its balance is the hard cap across instances, and each instance adds a best-effort per-IP limit (S-2). Planned: an atomic, durable reservation shared by all workers. | `node audit/tools/drip-proof.cjs` (tests `separate_instances_exceed_daily_cap`, `separate_instances_pay_same_address_twice`) |
| C01 | Medium | Payouts and keeper timing were promised without their conditions. | Fixed today (copy), except the landing hero paragraph (`web/src/components/landing/Hero.tsx`), held for another session's edits and pending | The M01 and M04 tests; keeper retries in `keeper/src/settle.ts` |
| C02 | Medium | Increasing timestamps were described as proof that a price is fresh. | Fixed today (copy; section 2, item 1) | `testSafety_oldMirrorAnswerCannotBeRetimestampedAsFresh` |
| C03 | Medium | Account registration was described as protection for the public replay. | Fixed today (copy; section 2, item 3) | The M02 test; public `createOffer` and `open` |
| C04 | Medium | Public receipts were overstated: holds and some failed trades leave none, and a hash does not prove that a model wrote the decision. | Fixed today (copy; section 2, item 5) | `testSafety_issuerBlockedTradeStillProducesBlockedReceipt`; holds stay off-chain (`agents/src/index.ts:162`) |
| M04 | Low | `health` reports an account settleable while a USDG pause or a frozen recipient will make the payout fail. A failed settle rolls back everything and can be retried. | Known, planned before any mainnet beta (milestone 1) | `testSafety_healthRejectsIssuerPausedSettlement`, `testSafety_healthRejectsFrozenPayoutRecipient` |
| M05 | Low | A trade blocked by the issuer (USDG paused) reverts and leaves no `Blocked` receipt. | Known, planned before any mainnet beta (milestone 1) | `testSafety_issuerBlockedTradeStillProducesBlockedReceipt` |
| S-2 | Low | The drip had no per-IP limit: one caller naming six fresh addresses used the whole 30 USDG daily budget. | Fixed today: a best-effort per-IP limit in the drip route. It is kept per server instance; the wallet balance (S-1) is the hard cap. | `node audit/tools/drip-proof.cjs` (test `same_ip_six_new_addresses_exhaust_daily_quota`); `npx tsx --test web/src/lib/drip/guard.test.ts web/src/lib/drip/route.test.ts` |
| W2 | Low | A malformed `settleTx` in an offline fixture could make `scripts/claim-letters.ts` write outside its output folder. | Fixed today: the worker requires a 0x + 64-hex transaction hash and keeps the final path inside the output folder. | `python3 audit/web-worker-confinement.py`; `npx tsx --test scripts/claim-letters.test.ts` |
| W3 | Low | Pages were served without baseline security headers. | Fixed today: `web/next.config.ts` sends `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` and a minimal `Permissions-Policy`. A Content-Security-Policy is planned; it has to allow the wallet and RPC connections. | `npx tsx --test web/next.config.test.ts`; `curl -sS -D - -o /dev/null <site>/` on a build with the change |
| W4 | Low | A JSON `null` body made the drip route throw instead of returning 400. | Fixed today: 400 for any body that is not an object with a string `address`. | `node audit/web-input-proof.mjs`; `npx tsx --test web/src/lib/drip/guard.test.ts web/src/lib/drip/route.test.ts` |
| C05 | Low | The no-admin, no-upgrade wording left out the keeper's power over prices and the issuers' controls. | Fixed today (copy; section 3) | `audit/evidence/deployment-validation.json`, `deployment-additional.json`; the C02 test |
| C06 | Low | The stock-share limit was described as a holding ceiling; it is checked after each buy only. | Fixed today (copy) | `_checkLimits` in `AgentAccount.sol`; the fixed-basket backtest |
| C07 | Low | Premiums were implied to change automatically with an agent's record, and record prices were claimed before records existed. | Fixed today (copy), except the landing hero pill and paragraph (`Hero.tsx`), held and pending: underwriters set premiums, and "record price" appears only where a record exists. Both team agents have one since the 4 Oct rebuild (Careful 1 trade; Bold 4 trades and 1 claim). | Fixed `feeBps` per offer; `shared/src/records/index.json` |
| C08 | Low | The demo script said the scripted gap claim had paid before it had. | Fixed today: the claim has now paid, and the copy uses its real numbers. A team-operated test account went from 92 to 75 USDG (a 25% loss against a 10% limit), and the bond paid 15.000001 USDG seconds after the Monday-open price. | [Settle tx](https://explorer.testnet.chain.robinhood.com/tx/0xbace67dfa4f25b92eca2f0b2806dc5cf6c9d802608aeee6622fff59cc296087c), block 128646129; `claimsPaid()` on the Replay cover `0x0b7BAaE5c0c19438a90D35A61D1700E6CfCB8330` returns 15000001 |
| C09 | Low | Oracle updates were described as market-hours only; the feeds also update outside NYSE core hours. | Fixed today (copy; section 5) | `python3 audit/evidence/claims-volatility.py` (writes `audit/evidence/feed-hours.json`) |
| C10 | Low | Three pricing and backtest labels: the net-principal basis, log returns, and a simulation that does not run the Solidity code. | Fixed today (copy) | Recomputed numbers in `audit/evidence/claims-volatility.json` and `claims-numeric.json` |
| C11 | Low | Claims about all other agent bonds, and about every Robinhood account opener using an agent, went beyond their sources. | Fixed today (copy), except two lines in files held for another session's edits (`web/src/app/(read)/judge/page.tsx`, `web/src/app/(tour)/tour/page.tsx`), pending | `audit/evidence/external-claims.json` |
| C12 | Low | The roadmap treated the existing permissionless offers, SDK and MCP server as future work. | Fixed today ([ROADMAP.md](ROADMAP.md)) | `BondlineMarket.createOffer` accepts any agent address; the six-tool MCP server |
| C13 | Low | ProofOfCover's capacity field, which numbers come from the chain, and the SDK's refusal coverage were overstated. | Fixed today (copy; section 1 too) | `ProofOfCover.isCovered` return fields; the checks in the SDK's `quoteCover` |

Operational findings, about running the keeper and the agents:

| Severity | Finding | Status | Proof |
|---|---|---|---|
| Medium | A restart can pick a different replay schedule unless the runtime record is explicit: the bundled records hold `replay.startsAt: null` and `speed: 24`. | Known. Before any restart or host move, keep the running `startsAt`, speed and window in one non-secret runtime record used by both services. | `replay` in `deployments/rhTestnet.json` and `shared/src/deployment.json`; `keeper/src/config.ts:101`, `:104`, `:131` |
| Medium | Nothing stops two hosts from running the same keeper or agent wallet, which would race nonces and duplicate decisions. | Known. Run exactly one leader per wallet, and move hosts only by a deliberate handoff. | `keeper/src/txqueue.ts:26`, `:91`; `agents/src/index.ts:277`; `agents/src/trade.ts:68` |
| Low | Chain totals update on their own, but the hero, agent records, gap story and letters are snapshots. | Known. After a new settlement, regenerate the snapshots and deploy a fresh build; judges should refresh and check the block and time a page shows. | `web/src/app/(read)/judge/page.tsx:23`; `web/src/components/market/data.ts:65`; `web/src/components/judge/gap.ts:38` |

## 7. Reporting a vulnerability

Open an issue on the public repository. For anything that could affect funds, describe the problem and the affected
contract and function without publishing a working exploit against the deployed testnet contracts, and say how you
would like to be credited. There is no bug bounty yet; a testnet bounty is part of the audit milestone in
[ROADMAP.md](ROADMAP.md). We do not list a private contact because we do not have one we can stand behind.
