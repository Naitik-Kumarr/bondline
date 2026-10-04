# Public-copy coverage ledger

Review date: 4 Oct 2026. This ledger accounts for the full README, all eight Markdown documents directly under `docs/`, and every content component rendered by `/` and `/judge`. Line ranges identify reviewed sections; individual discrepancies and exact replacement wording are in `audit/areas/claims.md` (C01–C13). Review means source/claim comparison, not a blanket assertion that every future plan, external legal statement or historical run was independently reproduced.

Status: **V** verified against source/current chain; **N** independently recomputed numeric output; **H** matches a stored historical report, not freshly rerun; **Q** needs the named qualification/correction; **P** explicit proposed work or recording instruction; **U** unavailable independent provenance; **R** reproduction recipe inspected, with authorized read-only portions executed under `audit/` only.

## README and docs: complete section coverage

| File and lines | Claims reviewed | Result and evidence |
|---|---|---|
| README 1–18 | Product structure, testnet, token/agent brands, risk trigger, competitor comparison, project/buildathon provenance | V for structure/configured components; Q C01/C07/C11; U for authorship/buildathon and actual historical model execution. |
| README 19–30 | Judge criteria, 172 tests/coverage/Slither, owners/upgrades, external account/funding figures, one-signature flow | V deployed facts/authorization; H test/security metrics; Q C05/C07/C11. External source support: `external-claims.json`. |
| README 31–53 | Backtest counts/payouts/ratios; ProofOfCover fields/address; SDK/MCP; Rust vectors/activation; Halmos/invariant/mutation counts | N backtest/current model vectors; V deployment/activation; H actual Rust execution, symbolic/mutation/deeper runs; Q C13 for free capacity meaning. |
| README 54–67 | Agent rules/records, fully reserved deposits, settlement/latency, labels | V capped reservation/trade restrictions; Q C01/C04/C06; illustration/demo labels found. |
| README 68–89 | Repository roles, install/test/dev commands, license | V file roles/MIT; R only local nonfork test/model commands were run; no installs or original rebuilds. |
| SECURITY 1–25 | Scope and external exclusions | V named source scope and dependencies; “not audited” is an author's status label, not independent legal/provenance evidence. |
| SECURITY 26–52 | Keeper/replay/issuer/trust authority, Claude wallets, stock inventory, claim letters | V configured authority, fixed addresses, replay source counts/spread, token pause/freeze getters and off-chain letter hash semantics; Q C01/C02/C03/C04; U actual historical Claude execution. |
| SECURITY 53–70 | Contract can/cannot table, money formulas, fresh prices, clone initialization/reentrancy/upgrades | V source and clean money proofs; Q C01/C05 for universal settle/no-upgrade text. |
| SECURITY 71–108 | 172 recorded tests, 8 invariants, coverage, Slither, 43/48 symbolic, mutation/deeper handler metrics | H stored output/count arithmetic checked; independent local baseline 168 pass plus separate 4/4 public-RPC fork pass; additional adversarial tests fail. Default baseline is 256 runs × depth 64, not the historical 1000 × 200 deeper run. |
| SECURITY 109–133 | No terms; stale feeds/gaps; simulation limits; post-settle holdings; timeouts; toxic-account gas exception | V source no-term, fresh-price/post-settle behavior; N source gaps/backtest; Q C09 hours; H historical gas/proof run measurements. No unconditional hostile-account gas guarantee is made here. |
| SECURITY 134–139 | Contact/reporting instructions and testnet/no-value warning | Instructions inspected; no messages sent. |
| TECHNICAL 1–39 | Architecture, roles, versions, clone guards/admin | V fresh build/source; configured Solidity 0.8.28/Cancun and OpenZeppelin 5.6.1; Q C04/C05. |
| TECHNICAL 40–88 | P/value/loss/limit/payout/fee/reserve rounding, withdrawals/close, no terms | V formulas and independently passing reservation/withdraw/close/double-settle tests; Q C01 absolute settle promise. |
| TECHNICAL 89–110 | Buy-share limit and all 13 named BlockReason guards, receipt/hash semantics | V enum/guard order and normal rule-return receipts; Q C04 all-outcome/provenance scope. |
| TECHNICAL 111–128 | EIP-3009 flow, domain fields/separator, no leftover USDG, issuer handling | V source/runtime/getters; front-run/replay proof passes. All four existing real-USDG/mainnet fork tests were independently rerun and passed; see `audit/evidence/fork-tests.txt`. Issuer reverts and close/pause semantics confirmed; Q C01 for broader text elsewhere. |
| TECHNICAL 129–156 | Mirror authority/timestamps, 24h/0.5% reported feed behavior, replay 79/33 rounds, speed/ages/spread/admission | N 79/33 historical source counts; V configured ages, spread, driver behavior; Q C02/C03/C09. The claimed heartbeat/deviation are supported as historical behavior, not a cryptographic guarantee of future feed availability. |
| TECHNICAL 157–194 | Suites, historical 172 passing/forks, gas medians/max | H stored test/gas reports and parser/render values; baseline independently rerun, followed by a separate four-test public-RPC fork run; all 172 original tests passed across both runs. No live transaction to measure gas was sent. |
| TECHNICAL 195–200 | Deployment chain/config/report references | V area-2 pinned snapshot, runtime/constructor checks and source explorer records. |
| TECHNICAL 201–207 | Testnet/venue/model limitations, stale prices, post-settle stock risk | V source/scoping; Q C09 “that means market hours”. |
| PRICING 1–17 | Reference-not-actuarial label, premium selection, trigger and overshoot purpose | V reference model/premium selection; Q C01 unconditional timing/trigger. Model assumptions are assumptions, not calibration/probability guarantees. |
| PRICING 18–70 | Formula/constants, Brownian reflection/overshoot rationale, CDF, ten sanity vectors, fair dollar base | N current 25 tests plus current TypeScript vs all stored vector values; Q C10 gross-deposit base. Bibliographic/model rationale inspected; no claim that selected gap horizon/loading is statistically proven. |
| PRICING 71–108 | Feed addresses/descriptions/phases/round counts, NYSE closes/holidays, scale breaks, sigma/CIs/largest returns | N fetched 2318 rounds and independent 72 closes/71 returns, sigmas 0.5457/0.3932; V official NYSE calendar; Q C10 log-return units. “Real” means the fetched feed history; no independent exchange-tape comparison was made. |
| PRICING 109–139 | Careful/Bold model breakdown, four limit rows, volatility sensitivity, AMZN-only prices | N current model and stored vector arithmetic; Q C06 stock-share heading/continuous-cap language. |
| PRICING 140–170 | Two price modes, record savings, w table and illustrative record, allowed exposure drift | V null-without-trades branch and stated drift caveat; N current model rows; Q C06/C07 unconditional two prices/cheaper premium. |
| PRICING 171–214 | Records/events/market tags, P95 exposure, drawdown, score weights/clamps, no-score-without-trades | V `shared/src/record.ts` and record-builder source; N 25 model/record tests; snapshots show zero executed trades and null prices/scores. Off-chain holds are absent, not a contrary on-chain record. |
| PRICING 215–231 | Model/term/premium/record limits | V deliberately scoped assumptions/no contract term/gross-net distinction and market tags; Q C01 unconditional minutes language. |
| PRICING 232–250 | Bibliographic references and reproduction commands | References/recipe inspected; R fresh numeric work used safe independent readers writing only `audit/`. `volatility.ts`/`record.ts` default output paths would modify original files, so those commands were not run. |
| BACKTEST 1–14 | Generation metadata, hypothetical label, motivating comparison | H old generation date/block; N new mainnet block 79836175 and identical output; Q C06/C10 basket/“same contract”. |
| BACKTEST 15–44 | All result-table numbers and interpretations | N complete fresh output equals stored data except generation time/block; 51/0 vs 51/17, 17.397931 payouts and 0.0082 offer-fee loss ratio. Annualized returns are correctly labeled window arithmetic. |
| BACKTEST 45–73 | 17 individual claims/timestamps/prices/loss/limit/payout/user loss | N all individual rows reproduced by the fresh run; not on-chain `Settled` receipts. |
| BACKTEST 74–97 | Every alternative basket, term/limit/latency and scale-error sensitivity | N all stored sensitivity machine outputs equal fresh rerun. |
| BACKTEST 98–112 | Principal, allocation, open days, 30-day hold, fresh-price settle, fees, value/reserve/capital assumptions | V recipe/source money formulas; N exact run; Q C01 latency promise. These are simulated assumptions, not observed keeper performance. |
| BACKTEST 113–122 | Overlap, in-sample volatility, fixed basket, single-event claims, annualization and feed gap caveats | N source window/gaps/cluster and outputs; Q C09 hours. Important uncertainty labels are present. |
| BACKTEST 123–140 | Feeds/1446/872 read, 37/26 discarded, 1409/846 used, dates/window/51 opening days, reproduce commands | N fresh public reads and regenerated results; R safe output flags used. |
| PROOF_OF_COVER 1–40 | Interface, active-cover test, limits/cap/free capacity/units, zero values on false, example | V source and pinned four covers; explicit free-capacity distinction correctly stated. README's broader summary needs C13. |
| PROOF_OF_COVER 41–72 | Staticcall/return-word validation, account authenticity, huge payload, hostile gas limits, no owner/setters/funds, next-block caveat | V source and original baseline ProofOfCover tests; H exact historical gas measurements. Gas failure is explicitly acknowledged, not treated as a finding here. |
| PROOF_OF_COVER 73–89 | 14 tests, 1000 fuzz and coverage 41/41,68/68,5/5,7/7, all listed hostile cases | V 14 test methods included in baseline; H deeper-fuzz/coverage stored run; source/test cases checked. |
| PROOF_OF_COVER 90–102 | Address, creation tx/block/time, immutable markets, partial explorer verification, 4 active/45 other historical reads | V bytecode/creation tx/constructor/active accounts against pinned evidence; H historical 45-address verifier run. |
| agents 1–29 | Public SDK/MCP, unsigned-only, Node22+ quickstart, public RPC/JSON/stdio, status labels | V source/tool setup and package engines; R quickstart install/start not run; U claim every line was historically run in a clean shell on the specified date. |
| agents 30–43 | All six named tools, inputs/outputs, USDG six-decimal units, errors | V registration and builders/amount parsing; Q C13 exhaustive `problems` wording. |
| agents 44–77 | Read/build methods, one-signature signer/payee, open/trade flow, decision hash | V source plus clean authorization/role tests; Q C04 non-revert/receipt scope. E2E transactions were not sent. |
| agents 78–100 | Canonical sorted JSON/800-byte object bound/string exception, minOut, model premium base, static/no-record behavior, team flags | V encoder/source and scoped text. String byte-for-byte exception is explicitly disclosed. |
| agents 101–111 | Unit/e2e/live/MCP test descriptions and local Anvil-vs-public distinction | H test recipe/source; no transaction-sending suites were run for this audit. |
| ROADMAP 1–11 | Current two markets/agents, no claims, no terms; chain KPI derivation | V baseline no claims/no terms/factory; Q C01 keeper promise and C12 team-only admission; P KPI plans. |
| ROADMAP 12–41 | Fixed terms, external audit, mainnet/legal review, vault deliverables/KPIs | P all explicitly future deliverables; no falsely deployed implementation inferred. |
| ROADMAP 42–52 | Open listing/SDK-MCP milestone and protocol fee | Q C12 SDK/MCP/open listing already exist; P self-serve expansion and fee. No current protocol fee is charged. |
| demo-video 1–45 | Recording directions, external facts, stock caps/current records, signatures, approval, planned gap payout/latency, pricing feedback, provenance of judge numbers | P directions are future recording steps, not proof of execution; Q C01/C04/C06/C07/C11/C13 factual narration. Exact 1%/5–20%/10% examples fit contract bounds. |
| demo-video 46–64 | Short pitch, 150k actual users, receipts, payout, fixed fee/model, purported paid scripted claim | Q C01/C04/C07/C08/C11. Latest direct claim total is 0 at block 128637073 (15:17:14 IST); recording must verify the future settle tx. |

## Website: complete rendered content coverage

| Route/component | Reviewed output | Result |
|---|---|---|
| `/` page | All seven landing sections, plus hero/market strip and shared footer status labels | Existing localhost responses archived as `home-local-3000/3110.html/.txt`; no canonical metadata URL resolved. |
| Hero | Product headline, usage/record, payout/cap/trigger, testnet/unaudited disclaimer | Q C01/C07; deployment and cap verified. |
| GapReplay + gap-demo.json | $1000 illustration, Friday−8%/Monday−25%, 10% limit/$100 user loss/$150 bond, explicit illustration status/no tx | N arithmetic and honest illustration label; not reported as an unlabeled fake claim. |
| MarketProof | Current total bond, cover, premium, claim labels and no-claim/scheduled text | V roundings agree with pinned chain; 121.22 bond,209.20 principal,6.22 premiums,0 claims, no outside activity. Values can change with replay. “Scheduled” is supported by party config but not proof of execution. |
| TheLine | Universal competitor contrast and rule/market payout claim | Q C11/C01; fixed trade guards do exist. |
| Differentiators | Market/independent underwriters, fully backed/capped risk, stock cap, actual components/reasoning | V reservation/deployment; Q C04/C06. “Independent” describes permissionless roles; actual observed wallets are team-run and labeled. |
| UsdgLine | USDG-only money flows, PDS/MAS issuer attribution, protocol disclaimer | V source/token; primary Paxos docs support the scoped issuer description. No assertion that Bondline itself is regulated. |
| NewsStrip | 150k openings/risk disclosure,15M seed/40M SeriesA/date/lead, insurer visibility and decisions | External figures supported; Q C04 visibility/every-decision language; not evidence of 55M insurance reserves. |
| Sides | Agent trade/refusal/reasoning, underwriter reserves and unblockable payouts, user payout | V rule/reservation roles; Q C01/C04. |
| ClosingCta | Every bond/cover/trade/refusal/claim is a transaction; route calls to action | Q C04 distinguish completed on-chain events from off-chain/failed decisions. Routes exist. |
| `/judge` page intro, labels and headings | Competitor contrast, proof promise, example/hypothetical/status labels, faucet100/day explanation | Q C11 intro; V honest illustration/pending claim and primary faucet limit. No manual tx inserted into moments. |
| Criteria | All five criteria and proof links, tests/deployments/admins,150k/55M,outside counts,current records,USDG | V deployed/external facts/outside0; H historical test metrics; Q C05/C07/C11. |
| WorkedExample | Principal1000/limit100/drop250/payout150/cap200/reserve200, gross1010.10/fee10.10, latency | N displayed rounded USDG arithmetic agrees with formula; Q C01 timing. Its input amounts are illustrations, not sampled live balances. |
| MomentsSection + moments reader | Offer40USDG; open104.17/fee4.17/principal100/reserve20; missing trade/refusal/claim placeholders | V successful public tx receipts in `judge-moment-receipts.json`; none of the missing moments is fabricated. Decision Verify rehashes bytes, not AI origin (C04). |
| CantTable | Cannot withdraw/change rules/release reserves/exceed capacity, market admin/holding balance, unblockable settle | V role/rule/reserve clean proofs; Q C01/C05. Public account admission does not make the venue private (C03). |
| Quality | Test/source/coverage/Slither/gas/fork numbers and verified addresses | H reports faithfully parsed/rendered; V deployed source records; current baseline168pass4skip explicitly distinguished. |
| Proofs | 43/48 +5timeouts, handler-call counts/early returns,747/720/27/230, verifier gate/not-an-audit label | H arithmetic and bounds/timeout/equivalence disclosures accurately match stored JSON; no independent rerun claimed by this audit. Verifier identity/history remains U. |
| BacktestSection | All displayed results and expanding caveats | N equal fresh machine output; proper hypothetical label; Q C01/C09 caveat wording inherited from generated JSON. |
| RealVsDemo | Actual contracts/prices/decision data, demo exchange/replay/gap/team labels, source-of-number split | V components/data source split and visible example labels; Q C04 AI decision provenance. No confirmed unlabeled hero gap was found. |
| QuickLinks/Links | Current market/agent/token/report/source links | V deployed addresses/public source targets and route definitions; canonical production domain U without reading environment files. |

## Reproduction/evidence map

- `audit/evidence/deployment-snapshot.json`, `deployment-validation.json`, `deployment-additional.json`, `fresh-build-compare.json`, `judge-moment-receipts.json`: pinned public chain and build verification.
- `audit/evidence/claims-current-snapshot.json`: four offers and zero actual claims at block128637073.
- `audit/evidence/backtest-rounds.json`: fresh primary mainnet price history at block79836175; `audit/backtest/data/backtest.json` is the independent rerun output.
- `node --import tsx audit/evidence/claims-numeric.mjs`: all stored model/vector/row results against current TypeScript and full old/fresh backtest equality, excluding generation time/block.
- `python3 audit/evidence/claims-volatility.py`: independently reconstructed NYSE closes/sigmas/returns/replay counts, plus measured timestamps outside core hours.
- `node audit/evidence/claims-stylus-live.mjs`: read-only current activationGas(), no activation/deployment transaction.
- `audit/evidence/claims-model-tests.txt`:25pass,0fail; `baseline-tests.txt`:168pass,4skip; `money-tests-offline.txt`:adversarial proof failures plus clean money checks.
- `audit/evidence/external-claims.json` plus `claims-external-supplement.json`: retrieved support and scope for external claims. Source URLs are linked in the findings.

No historical Rust/WASM execution, coverage, Slither, Halmos, mutation or deeper1000×200 invariant result was silently upgraded to an independent rerun. No outside insurer universe, legal position, affiliation or agent-model provenance is established solely by repository text.
