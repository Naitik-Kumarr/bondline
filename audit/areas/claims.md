# Area 5: public claims audit

Audited `/`, `/judge`, `README.md` and all eight `docs/*.md` files. Sources and rendered read-only localhost responses were reviewed; no original files, processes, builds or chain state were changed. Locations below refer to the audited source, with hashes in `audit/evidence/claims-source-inventory.json`. Chain balances are point-in-time observations while another session operates the replay. This report supplies copy corrections; the underlying money vulnerabilities belong in the money findings, not as duplicate copy-only vulnerabilities.

## Medium: C01 — settlement and keeper latency are promised without their conditions

**Locations:** `README.md:9`, `README.md:62`; `web/src/components/landing/Hero.tsx:29`, `web/src/components/landing/Sides.tsx:84`, `web/src/components/landing/Sides.tsx:97`; `web/src/components/judge/CantTable.tsx:28`, `web/src/components/judge/WorkedExample.tsx:104`; `docs/TECHNICAL.md:51`, `docs/TECHNICAL.md:74`, `docs/SECURITY.md:58`, `docs/PRICING.md:11`, `docs/PRICING.md:14`, `docs/PRICING.md:222`, `docs/BACKTEST.md:107`, `docs/demo-video.md:37`, `docs/demo-video.md:56`; rendered backtest caveat from `docs/data/backtest.json:97`.

**Proof:** `AuditMoneySafetyTest.testSafety_claimUnaffectedByDisallowedZeroValueStaleDonation` fails: an unsolicited listed stock with zero USDG valuation can block settlement. `testSafety_healthRejectsIssuerPausedSettlement` and `testSafety_healthRejectsFrozenPayoutRecipient` fail: health says settleable although the token transfer will revert. Passing `testClean_pausedSettlementRollsBackAllAccountingAndCanRetry` and `testClean_frozenSettlementRollsBackAllAccountingAndCanRetry` prove the settlement, including the stop, rolls back atomically. See `audit/evidence/money-tests-offline.txt`. `keeper/src/settle.ts` retries failures with increasing backoff; local sleep/outage, stale feeds, failed transactions and token controls preclude an unconditional minutes/seconds guarantee.

**Impact:** A buyer can believe the AI has stopped and payment is available when settlement cannot execute.

**Smallest fix / exact replacement:**

> Anyone can call `settle`. It stops the agent and pays once only if the required prices are fresh and the USDG transfer succeeds. USDG pause/freeze controls and unsolicited listed-stock dust can block settlement in the current code. The user can still stop the agent with `pause` or end cover with `close`.

For the underwriter row specifically:

> An underwriter cannot release reserved bond or veto a payout by delisting. Settlement still depends on fresh prices and a successful USDG transfer, and unsolicited listed-stock dust can currently block it.

For all timing promises:

> The keeper attempts settlement while it is running; transaction latency, stale prices and failed transfers can delay it. The backtest assumes settlement at the triggering round's price.

## Medium: C02 — increasing timestamps do not authenticate price age

**Locations:** `docs/SECURITY.md:35`, `docs/TECHNICAL.md:142`.

**Proof:** Failing `AuditMoneySafetyTest.testSafety_oldMirrorAnswerCannotBeRetimestampedAsFresh`; `MirrorFeed.push` authenticates the keeper and accepts any positive answer with a strictly newer non-future timestamp. It never authenticates a source round. `keeper/replay.ts` intentionally attaches current timestamps to historical answers.

**Impact:** Readers are told that the keeper cannot disguise an old answer as fresh, although freshness trusts that keeper.

**Smallest fix / exact replacement:**

> `MirrorFeed.push` requires a positive answer and a strictly increasing, non-future timestamp. It does not authenticate the source answer or timestamp: the keeper can submit an old or invented answer with a new timestamp. That authority affects trades, eligibility to settle and payout amounts.

## Medium: C03 — registered accounts do not protect the public replay from outsiders

**Locations:** `docs/SECURITY.md:43`, `docs/TECHNICAL.md:151`.

**Proof:** Failing `AuditMoneySafetyTest.testSafety_untrustedReplayParticipantCannotExtractVenueUSDG`. The test uses public `createOffer`, public `open` and legitimate agent trades around the known replay prices, extracting venue USDG. Passing `testClean_directEOACannotTradeAtVenue` proves the narrower direct-EOA restriction, not admission control.

**Impact:** The stated restriction is presented as protection against the exact arbitrage that permissionless account creation permits.

**Smallest fix / exact replacement:**

> The venue accepts registered Bondline accounts, but anyone can create an offer and account. This is not an admission barrier against trading ahead of the public replay; its team-supplied inventory remains exposed to that arbitrage.

## Medium: C04 — not every decision/refusal has a public receipt, and a hash does not prove AI authorship

**Locations:** `README.md:55`; `web/src/components/landing/NewsStrip.tsx:68`, `web/src/components/landing/Sides.tsx:70`, `web/src/components/landing/ClosingCta.tsx:22`, `web/src/components/landing/Differentiators.tsx:19`; `web/src/components/judge/RealVsDemo.tsx:13`; `docs/TECHNICAL.md:31`, `docs/TECHNICAL.md:101`, `docs/SECURITY.md:49`, `docs/agents.md:73`; `docs/demo-video.md:12`, `docs/demo-video.md:21`, `docs/demo-video.md:51`.

**Proof:** `agents/src/index.ts:162` explicitly keeps hold decisions off-chain. `AgentAccount.trade` hashes arbitrary supplied bytes; the contract does not verify their model, origin or truth. Failing `AuditMoneySafetyTest.testSafety_issuerBlockedTradeStillProducesBlockedReceipt` proves an issuer-blocked otherwise valid trade can revert without a `Blocked` event. Contract rule guards that return normally do emit receipts; not all failures pass through those guards.

**Impact:** Public records can omit holds and transaction failures, and cannot independently establish that a named model generated the reasoning.

**Smallest fix / exact replacement:**

> Submitted trades that complete emit `Traded` or a rule-check `Blocked` receipt with a hash of the submitted decision bytes. Off-chain holds and decisions never submitted are absent, and token or RPC failures may produce no receipt. The hash verifies the bytes, not that a model produced them.

For the NewsStrip comparison:

> Off-chain insurers evaluate agents through tests and monitoring. Bondline exposes submitted decision bytes and completed trade/refusal receipts publicly.

The [linked AIUC funding report](https://dealroom.co/news/150943-aiuc-lands-40m-series-a-to-insure-ai-agents/) describes evaluation/certification; it does not support “insurers can't see what agents do.”

## Low: C05 — no-admin/no-upgrade claims need the protocol boundary

**Locations:** `README.md:23`; `web/src/components/judge/Criteria.tsx:40`, `web/src/components/judge/CantTable.tsx:56`; `docs/TECHNICAL.md:38`, `docs/SECURITY.md:69`.

**Proof:** The deployed protocol bytecode, fixed clone targets and zero EIP-1967 slots support the protocol-only claim. External USDG is an EIP-1967/UUPS proxy; the two Stock Tokens are beacon proxies. The fixed keeper sets price inputs that affect money. See `audit/evidence/deployment-validation.json`, `audit/evidence/deployment-additional.json`, `audit/areas/deployment.md` and C02's failing proof.

**Impact:** A broad security summary can hide issuer upgrades and the keeper's material authority over economic outcomes.

**Smallest fix / exact replacement:**

> Bondline's own contracts are not upgradeable and its markets have no owner. The fixed keeper controls testnet prices, which affect trades and payouts; USDG and Stock Tokens retain issuer controls and upgrade paths.

## Low: C06 — the stock-share limit is a buy check, not a continuous holding ceiling

**Locations:** `README.md:55`; `web/src/components/landing/Differentiators.tsx:15`; `docs/BACKTEST.md:12`, `docs/PRICING.md:113`, `docs/PRICING.md:124`, `docs/demo-video.md:20`.

**Proof:** `AgentAccount.sol:352` checks share after a buy; price appreciation can subsequently raise it. `docs/TECHNICAL.md:96` and `docs/PRICING.md:168` already state this narrower behavior correctly. The backtest holds a basket initialized at 30%/80%; it does not rebalance to those ceilings.

**Impact:** Readers can mistake a trade admission rule for a permanent exposure bound or infer the modeled “worst case” is a continuous contract guarantee.

**Smallest fix / exact replacement:**

> A buy must leave stocks at or below the account's stock-share limit: Careful 30%, Bold 80%. Price changes can subsequently move that share above the limit. Payout liability is capped and reserved independently.

For model/backtest headings: replace “worst case under its rules” with **“reference price at the maximum stock share allowed after a buy”**, and replace “30%/80% stocks” with **“basket initialized at 30%/80% stocks”** where the basket is held fixed.

## Low: C07 — usage-based premiums and two current prices per agent are overstated

**Locations:** `README.md:8`, `README.md:25`; `web/src/components/landing/Hero.tsx:23`, `web/src/components/landing/Hero.tsx:29`; `web/src/components/judge/Criteria.tsx:110`; `docs/PRICING.md:142`, `docs/PRICING.md:148`, `docs/demo-video.md:21`, `docs/demo-video.md:42`, `docs/demo-video.md:60`.

**Proof:** Actual premiums are fixed underwriter-selected `feeBps`, charged once per deposit. Neither contracts nor keeper automatically change them from a record. Both published records have `hasRecord=false`, `trades=0`, `recordBps=null`; current agent pages can show only the rule-based reference price. `shared/src/pricing.ts` returns `record=null` when there is no observed record. Fresh deployed accounts were all cash with no trades at the area-2 snapshot.

**Impact:** The pitch suggests automatic behavioral pricing and current public track records that have not been established.

**Smallest fix / exact replacement:**

> Underwriters set premiums. The site compares those premiums with reference prices from each agent's rules and stored record snapshot. A lower modeled risk does not automatically change an offer's premium. Both team agents currently have only the rule-based reference price; a record price appears after executed trades and a record rebuild.

Replace the Hero pill with **“USDG protection for AI traders.”** For `docs/PRICING.md:148` specifically: **“An agent's lower observed exposure produces a lower reference price under this model; underwriters decide whether to offer a lower premium.”**

## Low: C08 — the pitch says the scripted gap has paid; the deployed book says zero claims

**Location:** `docs/demo-video.md:64`.

**Proof:** `node audit/evidence/claims-current-snapshot.mjs` returned zero `claimsPaid` for all four offers at testnet block **128637073**, timestamp **2026-10-04 15:17:14 IST**. Result: `audit/evidence/claims-current-snapshot.json`. `/judge`, the hero illustration and `docs/ROADMAP.md:9` honestly distinguish the planned claim from a paid one.

**Impact:** A recorded pitch based on this script could claim a successful live payout without a transaction proving one.

**Smallest fix / exact replacement:**

> The contracts are deployed on Robinhood Chain testnet. The scripted gap will be described as paid only after we verify its successful settlement transaction.

This must be rechecked before recording because another session is running the replay.

## Low: C09 — market-hours-only oracle updates are contradicted by the source history

**Locations:** `docs/TECHNICAL.md:135`, `docs/TECHNICAL.md:205`, `docs/SECURITY.md:117`, `docs/BACKTEST.md:120`; rendered caveat from `docs/data/backtest.json:109`.

**Proof:** Fresh mainnet round history at block **79836175** contains **426/1409** normalized TSLA rounds and **307/846** AMZN rounds outside NYSE core hours. Examples include TSLA 23 June **20:18:15** and **22:56:48 New York time**. `python3 audit/evidence/claims-volatility.py` writes `audit/evidence/feed-hours.json`. NYSE's [primary hours/calendar page](https://www.nyse.com/trade/hours-calendars) gives core hours 09:30–16:00 ET. This proves updates outside core hours; it does not claim all extended-session trading is closed.

**Impact:** The timing explanation incorrectly confines price updates and live settlement to the exchange's core session.

**Smallest fix / exact replacement:**

> These feeds include updates outside NYSE core trading hours. In this historical window the longest observed round gaps were 77.8 hours for TSLA and 77.1 hours for AMZN. Settlement waits whenever an included price exceeds the market's maximum age.

## Low: C10 — three numerical/method labels need correction

| Location | Proof and impact | Exact replacement / smallest fix |
|---|---|---|
| `docs/PRICING.md:56` | `fair` applies to net principal, while the gross deposit also contains its premium; existing section 7 and SDK arithmetic correctly distinguish them. | **“`fair` is a share of net principal covered. Multiply by that principal to get dollars.”** |
| `docs/PRICING.md:98` | The stated −15.7%/+14.2% are daily **log returns**. Ordinary close-to-close returns recomputed from the fetched rounds are −14.54446%/+15.28486%. Calling them ordinary “moves” mixes units. See `claims-volatility.json`. | **“The largest daily log returns in the window are retained: TSLA −15.7% on 23 July and AMZN +14.2% on 31 July. Those correspond to close-to-close price changes of −14.5% and +15.3%. Both changes appear throughout the feed history.”** |
| `docs/BACKTEST.md:13` | `scripts/backtest.ts` is a TypeScript simulation of formulas; it does not execute the Solidity contract. The fresh read-only rerun reproduced every stored output. | **“The simulation uses the same payout and reservation formulas, the same loss limit and the same feed history; it does not execute the Solidity contracts.”** |

## Low: C11 — competitor universals and actual use by all account openers are unsupported

**Locations:** `README.md:12`, `README.md:26`; `web/src/components/landing/TheLine.tsx:11`, `web/src/app/(read)/judge/page.tsx:46`, `web/src/components/judge/Criteria.tsx:116`; `docs/demo-video.md:16`, `docs/demo-video.md:48`, `docs/demo-video.md:51`.

**Proof:** The [official Robinhood announcement](https://robinhood.com/us/en/newsroom/hood-summit-2026/) supports more than 150,000 **account openings** and allocation of AI-trading risk to users. It does not prove every opener has let an agent execute a trade. The cited funding announcements do not establish that all other agent bonds pay only rule breaches or that nobody already insures gap risk. See `audit/evidence/external-claims.json`.

**Impact:** The pitch converts supported adoption figures into a stronger usage figure and asserts market-wide exclusivity without evidence.

**Smallest fix / exact replacements:**

> More than 150,000 Robinhood customers have opened agentic trading accounts; Robinhood's disclosure assigns AI-trading risk to users.

> Bondline combines trade-rule checks with capped payouts for market losses beyond a chosen limit.

> Bondline aims to cover a capped part of losses when prices move beyond a selected limit.

Keep the linked $15M seed and $40M Series A figures: the cited reports support them, and $55M is their sum, not proof of underwriting capital or policies sold.

## Low: C12 — the roadmap treats existing permissionless listing and SDK/MCP as absent

**Locations:** `docs/ROADMAP.md:8`, `docs/ROADMAP.md:42`.

**Proof:** `BondlineMarket.createOffer` permits any nonzero agent address; no team-agent allowlist exists. `docs/agents.md:3` correctly says markets are open to outside agents. The existing SDK and six-tool MCP server build unsigned transactions. This same permissionlessness is exercised in C03's failing test.

**Impact:** Present capability is misstated and a purported future admission change already affects the replay's security.

**Smallest fix / exact replacement:**

> Current demonstration covers name the two team agent wallets. The factory already permits offers for any agent address.

Replace milestone 5's heading with **“Self-serve agent pages and expanded SDK/MCP onboarding”** and its deliverable with **“Extend the existing SDK and six-tool MCP server with self-serve agent pages, record rebuilding and reference-price explanations.”**

## Low: C13 — proof capacity and source-of-number wording are too broad

| Location | Proof and impact | Exact replacement / smallest fix |
|---|---|---|
| `README.md:36` | `ProofOfCover.isCovered` returns the cover's **free sale capacity**, not the account's reservation or insured dollar amount. `docs/PROOF_OF_COVER.md:38` correctly explains this. | **“A read-only contract that reports whether an account has active cover, its underwriter, limit and cap, and the cover's free capacity. It does not return the account's reservation.”** |
| `docs/demo-video.md:43` | `/judge` also displays historical tests, model prices and simulated backtests; `RealVsDemo.tsx:14` correctly says this. | **“Market balances and transactions come from the chain; test metrics, reference prices and backtest results come from the named reports and models.”** |
| `docs/agents.md:35` | SDK `quoteCover` checks terms, rule bounds, capacity and optionally balance; it does not read issuer pause/freeze controls. Therefore `problems` cannot list everything execution would refuse. | **“`problems` lists the checked term, rule, capacity and optional balance failures. It does not guarantee execution: issuer pause/freeze controls, changing chain state and token failures may still cause a revert.”** |

## Checked and found clean

- **Deployed facts:** protocol runtime code and constructor inputs, immutable getters, USDG address/domain/decimals, source verification, two markets, fixed clone targets, cap 3000 bps, live age 90000 seconds, replay age 300 seconds, 10 bps venue spread, four active demonstration accounts and rounded balance totals. See area 2. No deployment mismatch was found.
- **Honest status labels:** the `$1,000`, 8%/25%, `$100`/`$150` hero and worked example are explicitly illustrations with no successful settle transaction. `/judge`'s on-chain moments correspond to successful public offer/open transactions and do not invent missing trades or claims. The testnet/unaudited/protection-bond and hypothetical-backtest labels are present.
- **Money formulas:** floor premium, ceil limit/reservation, floor payout cap, principal-scaled withdrawals, once-only settlement, release of only free bond, no fixed term, and `close` without token movement match the code. The copied original baseline passed **168** tests, and a separate read-only public-RPC fork run passed all **4** fork tests, independently validating all **172** original tests across those two runs. Evidence: `audit/evidence/baseline-tests.txt` and `audit/evidence/fork-tests.txt`. Additional audit tests expose the conditions above.
- **Pricing:** fresh model/record tests pass **25/25**. All documented example prices, stated parameters and scores match current TypeScript. All **16,071** stored Stylus expected vectors (**80,355** integers) and **10,001** off-chain price rows match the current model; this check does **not** execute Rust/WASM. Commands/results: `claims-model-tests.txt`, `claims-numeric.mjs`, `claims-numeric.json`.
- **Feed history/volatility:** fresh public mainnet read returned TSLA **1446** and AMZN **872** rounds. Independent Python from those rounds reproduced all **72** NYSE closes, **71** returns, sigma **0.5457/0.3932**, and replay counts **79/33**. NYSE holiday exclusions 3 July/7 September match the primary calendar. The early 37/26 scale-error rounds are excluded.
- **Backtest:** read-only `node --import tsx scripts/backtest.ts --out-dir audit/backtest --save-rounds audit/evidence/backtest-rounds.json` freshly reproduces all main tables, 17 individual claims, sensitivity outputs and parameters. Removing only generation time and source block, stored and fresh machine output are equal. Careful: **51** covers, **0** claims; Bold: **51**, **17**, **17.397931 USDG** payouts, offer-premium loss ratio **0.0082**, model-premium ratio **0.0195**. These are simulated covers, not on-chain claims.
- **Stylus status:** no deployment is claimed. At testnet block **128636214**, read-only `activationGas()` is still **18446744073709551615**. The [official Arbitrum notice](https://docs.arbitrum.io/notices/stylus-activation-pause-notice) confirms a pause on One/Nova, and the docs correctly distinguish that from measured Robinhood behavior.
- **Historical report arithmetic:** the stored proof report has **43/48** bounded proof instances with **5** timeouts; **8 × 200000** handler calls (including early returns); **720/747** killed compiling mutants, **27** survivors judged equivalent and **230** compile failures. Coverage totals and 172-test recorded results match their reports. They were inspected, not independently rerun in their entirety; green historical reports are not evidence that the new audit findings are absent.
- **SDK/MCP:** six tools are registered, builders return unsigned transactions, stablecoin amounts use six decimals, decision hashes compare bytes, records are explicitly static snapshots, and the one-signature domain/authorization paths match the clean Foundry proofs. End-to-end suites that deploy/send transactions were not run during this read-only audit.
- **External statements:** the cited Robinhood account-opening/risk disclosure, the funding headline amounts, and the [Paxos issuer/MAS description](https://docs.paxos.com/guides/stablecoin/usdg) are supported at their stated scope. Paxos's [public faucet](https://faucet.paxos.com/) displays 100 tokens and one request per wallet per day, supporting the judge example's faucet limit. MIT license exists; configured Solidity 0.8.28/Cancun and vendored OpenZeppelin 5.6.1 match the version claims.

## Limits

The canonical production URL could not be resolved without environment files, which were not read. Both existing localhost sites return Bondline; the source's fallback Vercel URL returned `DEPLOYMENT_NOT_FOUND`, which is not sufficient to declare the real deployment down. Local builds may use different build-time configuration. Exact third-party legal status, buildathon authorship/provenance, historical agent-model execution and historical verifier independence are not established by source code; those assertions were not silently marked as independently proven. Full Halmos, mutation, deeper invariant, coverage, Slither and Rust/WASM runs were not repeated. The line/section ledger documents all reviewed public copy and these scope limits.
