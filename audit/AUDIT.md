# Bondline independent audit

**Final report: 04 October 2026, 15:29 IST. Deadline: 4 October 2026, 16:00 IST. Fixes applied: none.**

Audit work, proof fixtures, copied contracts and build output are confined to `audit/`. Original source and live processes were not edited, stopped, restarted or rebuilt. No blockchain transaction was broadcast, no Drip HTTP POST was sent, and no model API call was made. Public RPC reads, local fork simulations, registry queries and GET requests to existing local sites were used. `.env*` files were never opened; secret values are not included in this report or scanner evidence. Parallel specialist reviews covered the six requested areas, followed by proof/severity cross-review.

## Assessment

**No Critical finding was proven.** The principal High contract finding is a conditional denial of claim/withdrawal caused by unsolicited zero-value stock dust. High dependency advisories are separately reported as inventory findings; a remotely reachable production exploit was not established. Medium findings include public replay inventory exposure, empty-offer enumeration growth and non-atomic Drip limits across instances. Exact public-copy replacements appear below.

No payout above a cover's reservation, double settlement, signature redirection/replay, or agent withdrawal escape was reproduced. This is a bounded independent audit, not a certification of every possible state.

**Deployment snapshot:** Robinhood Chain testnet block **128627492**, **4 October 2026, 14:57:36 IST**. All **11** protocol runtimes, expected immutables, nine top-level constructor inputs and eight clones match the isolated fresh build. Both markets hold zero USDG. Aggregate bond **121.216666 USDG**, reservation **41.84**, active principal **209.20**, premiums **6.216666**, claims **0** reconcile with local `/judge`. A later claims-only read at block **128637073**, **15:17:14 IST**, still found zero paid claims. Another session may change state after those snapshots.

**Production-site limit:** both existing localhost sites on ports 3000/3110 were inspected. The source fallback public URL returned `DEPLOYMENT_NOT_FOUND`; the actual production URL was not independently identified. Local headers and bundle inspection therefore do not certify the production proxy/environment. This does not establish that the canonical public site is down.

## Findings ranked by severity

Every contract finding has an executed failing Foundry test; negative keeper-assumption tests are explicitly separated from unauthorized-write defects. Each detailed entry supplies proof, one-line impact, minimal proposed fix and material limits.

| Severity | ID | Finding | Principal proof |
|---|---|---|---|
| Critical | — | None proven | Reservation, once-only settlement and permissions controls passed |
| High | M01 | Zero-value unsolicited stock dust obstructs claims/cash withdrawals | Two failing `testSafety_*StaleDonation` tests |
| High, advisory inventory | W1 | 7 High / 0 Critical dependency entries; 2 High in production inventory | Isolated `npm audit`; local PostCSS marker proof |
| Medium | M02 | Permissionless accounts can trade ahead of public replay history for venue subsidies | Failing `testSafety_untrustedReplayParticipantCannotExtractVenueUSDG` |
| Medium | M03 | Empty offers make whole-book enumeration unbounded | Failing 2M-budget test; measured 7,888,173 gas at 1,000 offers |
| Medium | S-1 | Multi-instance Drip bypasses recipient and daily quotas | Unchanged-handler mock proof: 35 vs 30 USDG, duplicate recipient |
| Medium | C01 | Unconditional payout/keeper timing promises omit execution conditions | Dust and pause/freeze tests; keeper retry code |
| Medium | C02 | Increasing timestamps do not authenticate source age | Failing authorized-keeper retimestamp assumption |
| Medium | C03 | Account registration is overstated as public-replay protection | M02 proof; public offer/account creation |
| Medium | C04 | Complete decision/refusal receipts and model provenance are overstated | Failing issuer-refusal receipt test; off-chain hold path |
| Low | M04 | Health reports success eligibility while issuer transfers will fail | Two failing paused/frozen health assertions |
| Low | M05 | Issuer-blocked trades can revert without a Blocked receipt | Failing issuer-blocked receipt assertion |
| Low | S-2 | No per-IP Drip quota | Same-IP six-address proof consumes daily allowance |
| Low | W2 | Malformed offline claim fixture can write outside chosen output folder | Dry-run fixture confinement assertion fails within audit/ |
| Low | W3 | Baseline security headers absent in local responses/source | Existing local GET header captures |
| Low | W4 | JSON null is an unhandled Drip validation exception | Isolated input-only validation proof |
| Low | C05 | No-admin/no-upgrade wording omits external issuer and keeper powers | Deployed source, proxy slots and keeper tests |
| Low | C06 | Stock share is a buy check, not a continuous holding ceiling | `_checkLimits`, fixed-basket backtest |
| Low | C07 | Automatic premiums and two current record prices are overstated | Fixed feeBps; no-trade record snapshots |
| Low | C08 | Demo script prematurely says a gap claim paid | Later snapshot: all claimsPaid still zero |
| Low | C09 | Market-hours-only oracle wording is false | Fresh round timestamps outside NYSE core hours |
| Low | C10 | Pricing basis/log-return/simulation labels need correction | Independent numeric recomputation |
| Low | C11 | Competitor universals and use by every account opener unsupported | Scope of cited public sources |
| Low | C12 | Roadmap treats existing permissionless SDK/MCP capability as absent | Current factory and six-tool MCP source |
| Low | C13 | Proof capacity, chain-only numbers and SDK refusal coverage overstated | Return fields and checked-source scope |

C01–C04 describe misleading assurances associated with the same underlying behavior, not four additional ways to lose reserved bond. M03's gas budget is an explicit local demonstration, not a proven live RPC outage. M02's large fixture profit is not a current deployed-wallet drain. S-1's funded-wallet exhaustion is a fully mocked multi-instance ordering, not a live dispensing test. Operations below also document continuity risks rather than pretending this audit deployed a droplet.

## Proof index

- Original copied Foundry suite: **168 baseline passes plus 4/4 real-token/mainnet fork passes = all 172 original tests independently passed across two runs**. Default baseline invariants used 256 × 64 = 16,384 calls each, not the historical deeper 200,000-call report. Evidence: `audit/evidence/baseline-tests.txt`, `fork-tests.txt` and status JSON files.
- New Foundry suite: **21 tests: 12 passing controls, 9 intentionally failed safety/trust assertions**, including 1,000 independent reservation fuzz cases. Command: `forge test --root audit/contracts --offline --match-contract AuditMoneySafetyTest -vv`. Tests: `audit/contracts/test/AuditMoneySafety.t.sol`; evidence: `audit/evidence/money-tests.txt`. Exit 1 is expected; compilation succeeded. Failures are grouped and calibrated above.
- Drip: `node audit/tools/drip-proof.cjs`; no network/signing; `audit/evidence/drip-proof.json`.
- Web: `node audit/web-postcss-proof.cjs`, `python3 audit/web-worker-confinement.py`, `node audit/web-input-proof.mjs`; intentional safety assertions fail. npm inventory/evidence and command details appear below.
- Deployment: `audit/evidence/deployment-validation.json`, `deployment-snapshot.json`, explorer/code probes and local HTML captures.
- Claims: `audit/evidence/claims-ledger.md` covers the full README, eight docs and all homepage/judge content; numerical outputs and source hashes are in the adjacent claims evidence files. Fresh backtest output is under `audit/backtest/`.
- Secret scanner outputs contain only file/line/classification, never matched values. No actionable secret was confirmed in scanned text; deliberate exclusions and unavailable environment/history checks are stated below.



---

## Area 1: money safety

Independent source review and isolated Foundry tests, 4 October 2026. No original source was changed. All builds and proof tests live under `audit/contracts/`; `lib` is a symlink to the existing dependency directory. No transaction was broadcast.

### Proof results

- `FORK_TESTS=false forge test --root audit/contracts --offline --no-match-contract AuditMoneySafetyTest -v`: 168 passed, 4 fork tests skipped; evidence `audit/evidence/baseline-tests.txt`.
- `FORK_TESTS=true forge test --root audit/contracts --offline --no-storage-caching --match-path 'test/fork/*' -v`: all 4 real-USDG/mainnet fork tests passed; evidence `audit/evidence/fork-tests.txt`. These are local fork simulations using read-only public RPC, not transactions on the network.
- `forge test --root audit/contracts --offline --match-contract AuditMoneySafetyTest -vv`: 21 tests, 12 passing controls and 9 deliberately failing safety/assumption assertions, including 1,000 fuzz cases. Exit 1 is expected for those assertions. Evidence `audit/evidence/money-tests.txt`, `money-status.json`; test file `audit/contracts/test/AuditMoneySafety.t.sol`.

Nine failed assertions are not nine independent vulnerabilities. Two expose the disclosed keeper trust boundary, two describe issuer-related health diagnostics, two cover the same dust issue, and the enumeration test uses a stated local gas budget. Every contract finding below has an executed failing test.

### Findings

#### High — M01: unsolicited zero-value stock dust can obstruct a payout and cash withdrawal

**Source:** `contracts/src/AgentAccount.sol:225`–valuation loop; `:237`–oldest timestamp; `contracts/src/BondlineCover.sol:309`–fresh valuation; `:316`–freshness condition. Exact function references are `_valuation`, `_freshValuation`, `_isFresh`.

**Failing proof:** `testSafety_claimUnaffectedByDisallowedZeroValueStaleDonation` opens an account whose mask permits TSLA only, makes its TSLA loss settleable with a fresh TSLA feed, then donates one wei of AMZN. Its USDG contribution rounds to zero, yet the stale AMZN timestamp makes `health.settleable` false. `testSafety_cashWithdrawalUnaffectedByZeroValueStaleDonation` proves a cash withdrawal reverts with `StalePrices` after the same zero-value donation.

**Impact:** anyone holding a listed stock token can conditionally block an otherwise eligible claim or cash withdrawal; ending cover with `close` abandons the claim.

**Smallest fix:** stop zero-valued dust from controlling freshness and add a narrowly constrained way for the owner to remove unsolicited/disallowed tokens during active cover, without enabling withdrawal of accounted-for covered assets. Material holdings must still be valued conservatively.

**Limit:** obstruction lasts until the donated stock's feed becomes fresh or cover is closed; this is not permanent seizure of all assets. The recipient's own agent cannot sell AMZN when its mask excludes it, and `sweepToken` is unavailable until release.

#### Medium — M02: public historical replay prices expose team venue inventory to predictable profitable trading

**Source:** `contracts/src/BondlineMarket.sol:93`–permissionless `createOffer`; `contracts/src/OracleVenue.sol:113`–registered-account admission; `keeper/data/replay-rounds.json`–published future replay history.

**Failing proof:** `testSafety_untrustedReplayParticipantCannotExtractVenueUSDG` uses a genuine publicly created cover and account, zero fee, a 29.99% limit and 100% stock rule. A small 0.01%-of-principal reservation satisfies the cap/limit arithmetic. It buys at a public historical TSLA price of $346.175 and sells at the later $374.37 price through the honest scheduled feed. Its assertion that venue USDG is preserved fails: fixture profit and venue loss are **63,428.345477 USDG**.

**Impact:** during an open Replay, permissionless participants can use known future prices to capture the team's inventory subsidy.

**Smallest fix:** restrict participation in this historical demo venue, isolate per-participant inventory/allowances, or clearly accept and budget the replay subsidy. A registered account check alone is not an admission limit.

**Limit:** the numeric result uses an 800,000-USDG account and a large funded mock venue; it is not a demonstrated drain of the current deployment. The pinned live Replay venue held **40 USDG and 3.5 TSLA**. Direct EOA calls remain rejected. This does not exceed a cover reservation or forge account membership, and is not a proven live-price arbitrage path.

#### Medium — M03: zero-bond offers produce unbounded whole-book enumeration

**Source:** `contracts/src/BondlineMarket.sol:93`, `:157`, `:181`; `keeper/src/settle.ts:78`; `web/src/components/market/data.ts` reads the entire offer list.

**Failing proof:** `testSafety_emptyOfferSpamRemainsEnumerableUnderTwoMillionGas` creates 1,000 unfunded offers and shows `offers()` fails under an explicit 2,000,000-gas call budget. Passing measurement control `testClean_measureEmptyOfferEnumerationCost` measures **7,888,173 gas** for 1,000 offers with cold account access but already-warm storage. Creation in the fixture costs about 307 million gas overall: spam still pays execution costs, and could be spread across transactions.

**Impact:** paid creation of empty offers can make keeper/site whole-book calls increasingly expensive and eventually exceed finite RPC or execution budgets.

**Smallest fix:** paginate enumeration and update callers to process bounded batches; filter inactive/unfunded offers operationally. A minimum bond alone is insufficient if it can immediately be released and the historical list remains unbounded.

**Limit:** 2 million gas is a test budget, not an established Robinhood RPC limit. No outage of the current four-offer deployment was demonstrated. This is a scalability/griefing risk, not proof that individual `settle(account)` is disabled.

#### Low — M04: health reports economic eligibility while issuer controls prevent settlement

**Source:** `contracts/src/BondlineCover.sol:251`, `:265`–`health`; `contracts/src/Types.sol:88`–success promise; `:177`–`settle`; `web/src/components/account/AccountActions.tsx:87`–settlement action; `keeper/src/settle.ts:118`–health-driven send.

**Failing proof:** `testSafety_healthRejectsIssuerPausedSettlement` and `testSafety_healthRejectsFrozenPayoutRecipient`: token transfers reject settlement, while `health.settleable` remains true.

**Impact:** UI and keeper can advertise/attempt a payout that currently cannot execute, causing user confusion and repeated failed attempts.

**Smallest fix:** distinguish price/loss eligibility from current payment readiness and check USDG pause/freeze status before offering/sending settlement. Do not promise that a view result guarantees execution.

**Clean behavior:** the failed transfer rolls back settlement status, bond/reserve/claim accounting, `stop` and `release` together. Unpause/unfreeze permits retry. `close` works without a transfer but ends protection. There is no paid-but-unrecorded claim or lost reservation in these tests.

#### Low — M05: issuer-blocked trades can revert without a Blocked receipt

**Source:** `contracts/src/AgentAccount.sol:106`, `:128`; `contracts/src/Types.sol:44`; `README.md:55` and related public receipt claims.

**Failing proof:** `testSafety_issuerBlockedTradeStillProducesBlockedReceipt` pauses USDG and submits an otherwise rule-compliant buy. The transfer reverts and no `Blocked` event survives.

**Impact:** the public history omits some failed decisions despite the stated complete-refusal-record guarantee.

**Smallest fix:** qualify the receipt guarantee to completed rule-check refusals, or implement a carefully isolated execution-failure receipt path that preserves atomic accounting. Off-chain holds and never-submitted decisions also cannot be reconstructed from events.

**Limit:** the agent does not move funds outside the permitted trade path. A reverted transaction cannot preserve events from its reverted frame.

### Keeper, venue and settlement trust boundary

Only the immutable keeper may push a MirrorFeed answer; there is no key rotation, owner setter or upgrade route. Positive answers and increasing non-future timestamps are enforced. The source answer and timestamp are not authenticated on-chain.

`testSafety_keeperCannotManufacturePayoutAgainstUnchangedReferencePrice` holds an external reference at $400 and changes only the mirror to $200. Settlement pays **198 USDG** against a **990-USDG** principal, even though the reference value is **989.208 USDG**, and remains within the reservation. `testSafety_oldMirrorAnswerCannotBeRetimestampedAsFresh` proves an old answer can be submitted with a new timestamp. These are deliberately failing assumptions about a trusted keeper, not unauthorized-write findings. They support the wording corrections in C02/C05.

A bad positive fresh price can move value through both venue trading and settlement; extreme answers may make arithmetic/valuation revert until corrected. An absent keeper leaves stock valuations stale and blocks settlement/withdrawal/trading until updates resume. Cash-only valuation remains fresh. Owners can pause the agent or close/release the account; closing abandons the payout. OracleVenue inventory has no admin withdrawal or rescue path: unsolicited inventory or a permanently unusable venue can remain there indefinitely by design.

### Every division in contracts/src

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

### Checked and found clean

- 1,000 independent fuzz cases of deposit/top-up/proportional withdrawal followed by loss: payout never exceeds the account's reserve and total reserved never exceeds bond.
- Underwriter cannot withdraw reserved bond; withdrawing all free bond and delisting still permits payout to existing accounts.
- Double settlement rejects the second call and transfers no second payout.
- Stale/non-positive/incomplete held prices reject settlement; price checks enforce configured ages and source consistency.
- Agent cannot withdraw, sweep, pay, release or reconfigure active funds; successful rule refusals do not change balances. Only fixed agent trades through the fixed venue; only owner/cover controls have their stated permissions.
- USDG receiveWithAuthorization: caller must be payee; changing sender breaks signature; unsuccessful front-running does not consume the nonce; successful use consumes it and replay fails. The real USDG fork confirms domain separator, one-signature funding and payee enforcement. No signature theft/redirection was reproduced.
- USDG pause/freeze transfer failures preserve all accounting and can retry; close remains available independent of prices/issuer token movement.
- Direct non-account venue callers are rejected; clone implementations disable their own initializers and created clones are initialized atomically.

No Critical finding was proven. No payout above reservation, double payout, or agent withdrawal escape was demonstrated. Historical proof/coverage/mutation reports were inspected separately; they do not cancel the newly reproduced findings.


---

## Live deployment audit

Audited read-only at Robinhood Chain testnet block **128627492**, hash `0x01dad82600e1d668e3083f53ff4057b4321db12fcc27061f818134f156959f66`, timestamp **4 October 2026, 14:57:36 IST** (`2026-10-04T09:27:36Z`). The public RPC returned chain ID **46630**. No transactions were sent; no processes were restarted; original files and `contracts/out` were read only. Fresh compilation was performed by the money-safety auditor inside `audit/contracts/`.

### Ranked findings

**No deployed-code, constructor, clone-target or bond-balance mismatch was proved.** The observed availability state below is evidence for the operational/claims audit, not a new contract vulnerability. No source-logic finding is asserted without a failing Foundry proof.

### Deployment checks found clean

- All **11 Bondline protocol addresses** in `deployments/rhTestnet.json` have code matching fresh `audit/contracts/out` artifacts: two markets, two venues, four mirror feeds, two implementations and ProofOfCover. The comparison zeros only compiler-declared immutable offsets, compares the entire remaining runtime including metadata, then separately checks **every occurrence of every immutable** against the manifest. The explorer's runtime hashes also equal the pinned RPC hashes. Commands: `node audit/evidence/deployment-probe.mjs`; `node audit/evidence/fresh-build-compare.mjs`; `node audit/evidence/deployment-validate.mjs`. Evidence: `audit/evidence/deployment-snapshot.json`, `fresh-build-compare.json`, `deployment-validation.json`.
- All **nine top-level deployment transaction inputs** exactly match fresh creation bytecode plus decoded constructor arguments. Both OracleVenue instances were created internally by their market constructors; their parent transactions, runtime bytes, `market`, `usdg`, spread and price-age getters were checked separately. The two market constructors use manifest USDG/implementations/assets/feeds, Live age **90000**, Replay age **300**, spread **10 bps**, and the correct labels. Every feed fixes keeper `0x77626a8118AA4a623EEFaB0FD2629ae796e64Ada`, **8 decimals**, and the expected description. ProofOfCover fixes the two correct markets. Command: `node audit/evidence/deployment-additional.mjs`; evidence: `audit/evidence/deployment-additional.json`, `explorer-snapshot.json`.
- All **four cover clones and four account clones** are the exact 45-byte EIP-1167 runtime targeting their respective manifest implementation. The targets have no upgrade path. Source/runtime review confirms no owner/admin/configuration setters on BondlineMarket, OracleVenue or ProofOfCover. All 11 protocol addresses have zero EIP-1967 implementation/admin/beacon slots. Account user controls, cover underwriter controls and the fixed mirror keeper are documented privileged roles, not absent roles. Source review plus matching deployed runtime is the proof; empty proxy slots alone would not establish this.
- `deployments/rhTestnet.json` and `shared/src/deployment.json` agree exactly; the copied audited top-level Solidity sources agree with the original source hashes. Evidence: `deployment-validation.json`.
- The USDG address matches [Paxos's official testnet documentation](https://docs.paxos.com/guides/stablecoin/usdg/testnet). RPC returns **Global Dollar / USDG / 6 decimals**, the shared EIP-712 domain separator `0xb1debe91e09d82163fd9cddaab89359061c0671664e1611258a3c3de7c2d950b`, `paused() == false`, and `isFrozen(address) == false` for all six manifest team wallets. TSLA/AMZN return the expected symbols/names and **18 decimals**. Evidence: `deployment-snapshot.json` and `deployment-additional.json`. The external Stock Token addresses were checked against the manifest, chain identity and explorer verification; current official Robinhood docs expose a mainnet registry and did not independently enumerate these testnet addresses in the retrieved page.
- Explorer reports all 11 protocol addresses verified; they are regular deployments, not upgradeable proxies. Independent runtime/creation comparisons above provide stronger evidence than relying on the explorer verification badge. Public explorer checks are in `explorer-snapshot.json`.

### Balances and displayed numbers

All amounts below are USDG (6 decimals). Each cover's actual USDG balance equals its `bond()` ledger, `reserved()` equals the sum of its account position reservations, and `free() = bond - reserved`. Both markets hold **0 USDG**.

| Market / offer | Actual balance = bond | Reserved | Free | Premiums | Claims paid |
|---|---:|---:|---:|---:|---:|
| Live / Careful | 25.300000 | 5.940000 | 19.360000 | 0.300000 | 0 |
| Live / Bold | 26.250000 | 6.000000 | 20.250000 | 1.250000 | 0 |
| Replay / Bold | 44.166666 | 20.000000 | 24.166666 | 4.166666 | 0 |
| Replay / Careful | 25.500000 | 9.900000 | 15.600000 | 0.500000 | 0 |
| **Total** | **121.216666** | **41.840000** | **79.376666** | **6.216666** | **0** |

Four accounts are active, have **209.200000 USDG principal** in total, and each holds cash only at the pinned block. Live venue inventory is **30 USDG + 1.5 TSLA + 1.5 AMZN**; Replay venue inventory is **40 USDG + 3.5 TSLA + 3.5 AMZN**. These venue balances are separate from cover bonds.

Read-only GETs of the already running Bondline sites on localhost ports **3000** and **3110** returned HTTP 200. Both `/market` displays reconcile after display rounding: **$121.22 bonded, $209.20 cover sold, $6.22 premiums, $0 claims, four covers/four active, zero outside underwriters/buyers, one team underwriter/buyer**. The pages identify nearby read blocks **128628396** and **128627857**, respectively; mutable values were equal across these snapshots. Saved pages/text: `audit/evidence/market-local-{3000,3110}.{html,txt}` and `judge-local-{3000,3110}.{http,txt}`.

`/judge` displays a **$40 bond** created using `createOfferWithAuthorization`, and a **$104.17 deposit / $4.17 fee / $100 principal / $20 reservation**, matching these successful receipts exactly:

- Offer: `0xb0b099a4f9e8b272a0677d2988c46b893625b6be81e0a0610aa914c69dd182f5`, block **128336377**; `OfferFunded.bond = 40000000`.
- Cover: `0xbb0d0fd9729e64d06ffebad1671bb5914052e58be5e9037039c9913ed6767b78`, block **128336484**; `Deposited.amount = 104166666`, fee **4166666**, net **100000000**, reserve **20000000**.

Command: `node audit/evidence/judge-receipt-probe.mjs`; evidence: `audit/evidence/judge-moment-receipts.json`. `/judge` honestly reports no trade, refusal or claim yet in the captured rendered state.

### Observed availability and trust boundaries

At the pinned block, both Live feeds are stale (**135125 / 135379 seconds old**, versus **90000** allowed). This is consistent with the declared weekend limitation. Both Replay feeds are also stale (**42171 / 42168 seconds old**, versus **300** allowed), with last pushes around **03:15 IST**. In that state, fresh-price trades fail, and a stock-holding account cannot settle from those stale prices. The four audited accounts currently hold only cash, so this does not presently conceal a loss payout. The parallel replay session may change this state; it must be checked again before describing the demo as trading live. Proof is the pinned `latestRoundData` RPC results in `deployment-snapshot.json`, not an assumption about whether a process exists.

The protocol's no-upgrade claim must be scoped to **Bondline's own contracts**. External USDG is an **EIP-1967 proxy** whose implementation at the audited block is `0xF0863D7A29a55d0c4263c11bFac754312ff078DF`. TSLA and AMZN are **beacon proxies**, both using beacon `0x1DF3Ca0FD30ED5Eeb09Eb01938f4e9c5196e6Ca5`. Their issuer upgrade/control surfaces are outside the Bondline build. Zero EIP-1967 admin storage on a UUPS token does not mean it lacks upgrade authority. MirrorFeed's fixed keeper controls every positive price pushed to its feed; immutable keeper does not authenticate a Chainlink price.

### Limitations

The public fallback domain named in `web/src/app/layout.tsx`, `https://bondline-mauve.vercel.app`, returned **HTTP 404 / DEPLOYMENT_NOT_FOUND** on `/judge` and `/market`. This proves that fallback URL is unavailable; it does **not** prove an unknown environment-resolved production deployment is offline. No canonical/`og:url` identifying a different public domain was present in the captured local judge HTML; port 3110's HTML used the fallback domain. The local pages were verified, but a current independently accessible public site URL was not established without reading private configuration. Evidence: `audit/evidence/judge-live-response.http`, `judge-live.txt`, `market-live.txt`.

No attempt was made to pause/freeze USDG, push a keeper price, mutate balances, exercise external token upgrades, or send any test transaction to the live chain. The token's own implementation is externally supplied and was not built as a Bondline source contract. Fork/source behavior belongs to the money-safety proof tests.


---

## Area 3: secrets and judge drip

Audited read-only on 4 October 2026, with evidence completed before 15:15 IST. No environment file was opened, no secret value was displayed or copied into audit evidence, and no network POST, signing, transfer, restart, rebuild, or original-file edit was performed. Proofs execute the unchanged drip handler against isolated mocked RPC clients.

### Findings

#### S-1 — Medium: separate server instances bypass the drip's recipient and spending limits

- Source: `web/src/app/api/drip/route.ts:33`, `:35`, `:71`, `:72`, `:75`, `:82`, `:92`, `:117`.
- Proof command: `node audit/tools/drip-proof.cjs`. Evidence: `audit/evidence/drip-proof.json`, tests `separate_instances_exceed_daily_cap`, `separate_instances_pay_same_address_twice`, and `separate_instances_drain_funded_wallet_from_same_ip`.
- Result: seven module instances all read the same confirmed-transfer history before sending, then obtain valid pending nonces and send **35 USDG despite the 30 USDG cap**. Two instances pay the same recipient **10 USDG despite one claim per wallet**. Twenty instances, all with the same request IP, drain the modeled wallet from **100 to 0 USDG**. The actual TypeScript handler runs unchanged; RPC, wallet, and responses are stubs, with zero network calls and zero signed transactions.
- Impact: concurrent requests against multiple Next/Vercel workers can exhaust test USDG reserves and give repeat claims, denying judges the promised limited faucet.
- Smallest fix: make recipient eligibility and the rolling spend budget an atomic durable reservation shared by all workers; use one signer queue and retain reservations until the transaction has a terminal outcome. A module-local Promise queue cannot enforce a deployment-wide limit.
- Limit: this proves handler logic under a valid multi-instance/RPC ordering; it does not assert that the current deployment actually ran twenty concurrent instances or that a live wallet was drained.

#### S-2 — Low: there is no per-IP quota

- Source: `web/src/app/api/drip/route.ts:106`, `:113`, `:117`.
- Proof command: `node audit/tools/drip-proof.cjs`. Evidence: `audit/evidence/drip-proof.json`, test `same_ip_six_new_addresses_exhaust_daily_quota`.
- Result: six sequential requests from one modeled IP, each naming a fresh address, all return 200 and consume the full **30 USDG** daily allowance. A seventh legitimate request gets 429. The route never reads the IP or any identity other than the submitted wallet address.
- Impact: one caller can exhaust the judge drip's daily allowance with six fresh addresses, even when only one server instance runs.
- Smallest fix: add a shared, trusted-client-IP rate limit before the RPC work and pair it with the existing address limit; keep the global spend reservation from S-1.

### Checked and clean within the stated scope

- **Drip signing key stays server-side in source.** Its environment lookup occurs only at `web/src/app/api/drip/route.ts:58`, within the Node API route. `audit/evidence/drip-client-isolation.json` records zero references to that signing-key environment name across **3,193** built static JavaScript/JSON/source-map files. No key value was examined or printed.
- **Sequential address and daily limits work in one instance.** The actual handler rejects a repeated recipient with 409 and the seventh sequential 5 USDG payment with 429 in `audit/evidence/drip-proof.json`.
- **Issuer and team checks exist.** Before sending, the route checks USDG pause, recipient freeze, and balance at `web/src/app/api/drip/route.ts:62`; team recipients are refused at `:115`. These are source checks, not live dispensing tests.
- **Ignore coverage is present.** `node audit/tools/check-ignore-rules.cjs` verifies both `.gitignore` and `.vercelignore` ignore root and nested `.env` variants, `_private/`, and `logs/` using the installed `ignore` implementation. All tested paths are ignored, including `.env.example` because the later `.env*` rule re-ignores it. Evidence: `audit/evidence/ignore-rules.json`.
- **No actionable secret literal was confirmed in scanned text.** `python3 audit/tools/scan-secrets.py` scanned **7,849 UTF-8 files / 480,618,090 bytes**, including private notes and logs and **196,248,601 bytes** of built client assets across `.next`, `.next-a`, `.next-b`, `.next-e`, `.next-fv2`, `.next-int`, `.next-local`, `.next-preview`, and `.next-ve`. There was no standalone build directory. Evidence: `audit/evidence/secrets-scan-final.json`.
- **All primary scanner candidates were resolved without exposing values.** `python3 audit/tools/review-secret-candidates.py` classified all **28** candidates as dependency documentation examples, names of local-storage keys, or source/HTML fragments; **zero remained unresolved**. Private-key-shaped literals matched public `ox` documentation examples internally and were not treated as deployed wallet secrets. Evidence: `audit/evidence/secrets-reviewed.json` contains filename, line, and classification only.
- **Mnemonic/RPC credential follow-up was clean.** `node audit/tools/scan-mnemonics-rpc.cjs` found **44** checksum-valid mnemonic literals, all internally matched to public dependency documentation; no unresolved mnemonic or credential-bearing API/RPC URL was found. Evidence: `audit/evidence/secrets-mnemonics-rpc.json`, filename/line/classification only.
- **Public environment variable names in application source were appropriate categories.** The client-name scan found only the wallet connection project identifier, browser RPC URL, and E2E account address setting. None was named as a private key, password, or server API secret. Evidence: `audit/evidence/drip-client-isolation.json`. Actual environment values were deliberately not opened, so this is not a certification of every deployed environment setting.

### Limits

- All **three `.env*` files were skipped without opening**, including templates, as expressly requested.
- `node_modules`, `.git`, audit output, Python/Rust vendor/build directories, symlinks, and contract dependency/generated artifact folders were excluded from the primary whole-folder scan; dependency documentation was read programmatically only to resolve public fixture false positives. **471 binary files and 42 files larger than 35 MB** were skipped. The scan therefore does not certify packed build caches, binary assets, arbitrary encrypted material, or unknown secret formats.
- This workspace has **no `.git` repository**. Git tracking/history and whether a previously committed secret was removed cannot be checked here; ignore-pattern behavior was verified independently.
- No running site's environment, hosting secret store, or drip wallet key was opened, and the faucet was never called over the network. Server-only key placement is supported by source and built-bundle inspection, not by inspecting the production secret value.
- The live replay may continue changing logs/state during the audit; this is a read-only snapshot, not a filesystem freeze.


---

## Area 4: Web, dependency inventory and claim-letter confinement

Independent review completed 4 October 2026 at 15:13 IST. Original files were unchanged. Dependency audit used copied manifests/lockfile under `audit/npm/`; caches, logs, fixtures and proof outputs are under `audit/`. No install, package fix, site rebuild, process restart, model call or transaction occurred. No environment file or secret value was read. Live checks were GET requests only; `/api/drip` was never called over HTTP.

### Findings

#### High — W1: lockfile contains high-severity vulnerable dependency versions

**Proof:** from `audit/npm/`:

```sh
npm audit --package-lock-only --audit-level=high --json --registry=https://registry.npmjs.org --cache=/Users/naitik/surety/audit/npm-cache --logs-dir=/Users/naitik/surety/audit/npm-logs
npm audit --package-lock-only --omit=dev --audit-level=high --json --registry=https://registry.npmjs.org --cache=/Users/naitik/surety/audit/npm-cache --logs-dir=/Users/naitik/surety/audit/npm-logs
```

Both exit 1 for findings. `audit/evidence/npm-audit.json` reports **7 High / 0 Critical** dependency entries; the production-only result (`npm-audit-production.json`) reports **2 High / 0 Critical**. Entries propagated through a dependency chain are not seven independent exploit classes. Moderate findings are outside the requested severity scope.

| Affected inventory | Version and location | High advisory / scope |
| --- | --- | --- |
| PostCSS nested under Next | `8.4.31`, `package-lock.json:11290`, `node_modules/next/node_modules/postcss` | Arbitrary file/source-map loading from CSS `sourceMappingURL`; [GHSA-6g55-p6wh-862q](https://github.com/advisories/GHSA-6g55-p6wh-862q), [GHSA-r28c-9q8g-f849](https://github.com/advisories/GHSA-r28c-9q8g-f849). Production lockfile dependency, typically used when building/processing CSS. |
| `ws` under Reown/WalletConnect | `8.18.0`, four instances; representative `package-lock.json:3670` and `:6569` | Peer-controlled fragment/chunk memory exhaustion; [maintainer advisory](https://github.com/websockets/ws/security/advisories/GHSA-96hv-2xvq-fx4p). Production dependency inventory. |
| `braces` → `micromatch` → `fast-glob` → Next ESLint plugin/config | `3.0.3` / `4.0.8` / `3.3.1` / `15.5.27`; `package-lock.json:7191`, `:8408` | Deep-pattern recursion exhaustion, [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm). These five high entries are development dependencies. The reviewed advisory lists no patched `braces` release. |

A local proof confirms the installed PostCSS behavior, without reading any secret or system file:

```sh
node audit/web-postcss-proof.cjs
```

It writes its own harmless source-map marker under `audit/web-postcss-proof/`, parses CSS naming `../outside.map`, reports `postcssVersion: 8.4.31` and `loadedOutsideMarker: true`, and deliberately fails its confinement assertion. Output: `audit/evidence/web-postcss-proof.txt`.

**Impact:** vulnerable libraries can disclose readable files when given untrusted CSS, or exhaust a process when given hostile WebSocket/glob input; production-route exploitability was not established.

**Smallest proposed fix:** update the affected transitive instances through compatible dependency upgrades or targeted overrides: PostCSS **8.5.18 or later** removes the two listed high advisories; `ws` **8.21.0 or later** removes the listed high `ws` advisory. Verify all nested instances and normal build/wallet behavior. Keep unpatched `braces` tooling away from untrusted patterns and track its upstream fix. Do not apply the audit tool's broad `--force` suggestions blindly: its proposed resolutions include major Next/wagmi changes and an ESLint-config downgrade. No fix was applied.

**Qualification:** the reviewed API routes do not accept CSS or glob expressions and do not create a public WebSocket server. The `ws` copies are under wallet SDK packages; package presence does not prove those Node implementations ship to browsers or run on the deployed server. The high ranking here preserves the advisory/inventory severity, not a claim that a stranger can currently read Bondline's keys or crash its public site.

#### Low — W2: malformed offline fixture transaction hash escapes the worker's specified output directory

**Source:** `scripts/claim-letters.ts:340` casts a fixture's `settleTx` without validation; `:369` joins it into the filename; `:417` writes that path. The dry-run directory guard (`:74`) checks the chosen output directory, not the final per-letter path. `--out-dir` itself is intentionally operator-controlled.

**Proof:**

```sh
python3 audit/web-worker-confinement.py
```

The unchanged worker is run with `--dry-run --once --fixture` and a specified output directory entirely inside `audit/`. The fixture supplies `settleTx: "../fixture-escaped"`. The worker exits 0 and writes `audit/web-worker-proof/fixture-escaped.json`, outside its specified `worker-output/` folder; the proof's expected-confinement assertion exits 1. See `audit/evidence/web-worker-confinement.json` and `web-worker-confinement-run.txt`. No API/network/model call occurred and the escaped file remains within `audit/`.

**Impact:** an operator processing an untrusted malformed fixture can write or replace JSON outside the chosen fixture-output folder.

**Smallest proposed fix:** require a canonical 32-byte transaction hash before building any letter path, then resolve the candidate and enforce containment under the chosen output root. Apply the same validation to fixture and RPC events.

**Qualification:** production transaction hashes returned by a normal chain RPC have the correct hex form; this proof establishes the offline fixture path, not public API traversal or model-controlled filenames. The generated model text does not choose an output path.

#### Low — W3: document responses lack baseline security headers

**Proof:** read-only GET of `http://127.0.0.1:3000/` returned 200; the invalid Verify request returned 400, and `http://127.0.0.1:3110/badge/not-an-address` returned 404. Captured headers are in `audit/evidence/web-local3000-root-headers.txt`, `web-local3000-headers.txt`, and `web-local3110-headers.txt`; the summary is `web-headers-summary.json`. None contains CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy or Permissions-Policy. `web/next.config.ts` has no header policy and no middleware/header configuration was found in the reviewed source.

Reproduce the document check without retaining its body:

```sh
curl -sS --max-time 20 --dump-header audit/evidence/web-local3000-root-headers.txt --output /dev/null http://127.0.0.1:3000/
```

**Impact:** the pages can be framed, and browser protections against content-type confusion and script injection are weaker than a configured policy would provide.

**Smallest proposed fix:** configure page anti-framing (`frame-ancestors 'none'` and/or `X-Frame-Options: DENY`), `nosniff`, a conservative referrer policy and permissions policy in Next or the HTTPS proxy; implement a CSP compatible with Next scripts and wallet/RPC connections. Add HSTS at the actual HTTPS deployment after validating its hostname policy.

**Qualification:** these are existing local development servers. HSTS absence on local HTTP is not a production TLS finding, and a public hosting proxy may add headers; no public response was verified here. No XSS exploit or wallet-signature bypass is claimed. `poweredByHeader: false` is configured and the captured responses omit X-Powered-By.

#### Low — W4: valid JSON `null` causes an unhandled Drip validation exception

**Source:** `web/src/app/api/drip/route.ts:109` parses JSON, then `:113` accesses `body.address` outside both the parse catch and the transaction catch.

**Proof:**

```sh
node audit/web-input-proof.mjs
```

The proof extracts only the unchanged handler body, replaces TypeScript annotations, and supplies inert wallet/RPC stubs that throw if reached. `null` throws `TypeError: Cannot read properties of null (reading 'address')`; `{}`, a numeric address, a null address and a URL string return 400. The expected-400 assertion exits 1. Output: `audit/evidence/web-input-proof.txt`. No HTTP POST was made and no secret or transaction path was reached.

**Impact:** a malformed request yields an uncontrolled server error instead of the documented validation response, creating unnecessary error/log load.

**Smallest proposed fix:** validate that parsed JSON is a non-null object with a string `address` before dereferencing it; return 400 for all other shapes. Financial/rate-limit Drip findings belong to area 3 and are not duplicated here.

### Checked and clean

- Route inventory is exactly `/api/verify`, `/api/drip` and `/badge/[account]`. Verify accepts only a transaction hash and address (`api/verify/route.ts:11`); invalid GET returned 400 before RPC work. It relays public transaction input/topics and does not choose an outbound URL from request data.
- Badge strips an optional `.svg`, validates the address, and returned 404 for an invalid address. Its SVG uses fixed strings, enum choices and formatted numeric values; raw route input is not interpolated into markup. Cross-origin access is intentional for public embeddable badges.
- RPC destinations come from server configuration or fixed chain metadata. Request-controlled hashes/addresses become RPC parameters, not network hosts; no URL-fetching API or obvious SSRF path was found in the three routes. Explorer/source-verification destinations are fixed configured explorer services.
- Drip rejects invalid non-null address shapes and team recipients, and directs transfers only to the validated address on a fixed token/chain. This area did not send test requests to its transaction-capable handler.
- No request-driven shell command, server `eval`, runtime code execution, or user-controlled filesystem path was found in `web/src`. The sole reviewed `dangerouslySetInnerHTML` is the static noscript CSS literal in `app/layout.tsx:41`.
- The worker's model output is checked for size, permitted numeric strings, required links and scripted-gap labelling. Fixtures require dry-run; template letters are labelled and excluded from the site's normal letter display. No model call was needed for these checks.

### Limits

No source fixes, lockfile changes, installs, rebuilds, load tests, hostile WebSocket traffic, live financial API requests or process changes were performed. The public deployed domain and its response headers were not verified. Library proofs establish local vulnerable behavior, not an exposed production attack route. Secrets, Drip wallet draining/rate limits and bundle leakage are separately assigned to area 3. All intentional proof failures are regression/safety assertions; they are not failed setup or compiler runs.


---

## Area 5: public claims audit

Audited `/`, `/judge`, `README.md` and all eight `docs/*.md` files. Sources and rendered read-only localhost responses were reviewed; no original files, processes, builds or chain state were changed. Locations below refer to the audited source, with hashes in `audit/evidence/claims-source-inventory.json`. Chain balances are point-in-time observations while another session operates the replay. This report supplies copy corrections; the underlying money vulnerabilities belong in the money findings, not as duplicate copy-only vulnerabilities.

### Medium: C01 — settlement and keeper latency are promised without their conditions

**Locations:** `README.md:9`, `README.md:62`; `web/src/components/landing/Hero.tsx:29`, `web/src/components/landing/Sides.tsx:84`, `web/src/components/landing/Sides.tsx:97`; `web/src/components/judge/CantTable.tsx:28`, `web/src/components/judge/WorkedExample.tsx:104`; `docs/TECHNICAL.md:51`, `docs/TECHNICAL.md:74`, `docs/SECURITY.md:58`, `docs/PRICING.md:11`, `docs/PRICING.md:14`, `docs/PRICING.md:222`, `docs/BACKTEST.md:107`, `docs/demo-video.md:37`, `docs/demo-video.md:56`; rendered backtest caveat from `docs/data/backtest.json:97`.

**Proof:** `AuditMoneySafetyTest.testSafety_claimUnaffectedByDisallowedZeroValueStaleDonation` fails: an unsolicited listed stock with zero USDG valuation can block settlement. `testSafety_healthRejectsIssuerPausedSettlement` and `testSafety_healthRejectsFrozenPayoutRecipient` fail: health says settleable although the token transfer will revert. Passing `testClean_pausedSettlementRollsBackAllAccountingAndCanRetry` and `testClean_frozenSettlementRollsBackAllAccountingAndCanRetry` prove the settlement, including the stop, rolls back atomically. See `audit/evidence/money-tests-offline.txt`. `keeper/src/settle.ts` retries failures with increasing backoff; local sleep/outage, stale feeds, failed transactions and token controls preclude an unconditional minutes/seconds guarantee.

**Impact:** A buyer can believe the AI has stopped and payment is available when settlement cannot execute.

**Smallest fix / exact replacement:**

> Anyone can call `settle`. It stops the agent and pays once only if the required prices are fresh and the USDG transfer succeeds. USDG pause/freeze controls and unsolicited listed-stock dust can block settlement in the current code. The user can still stop the agent with `pause` or end cover with `close`.

For the underwriter row specifically:

> An underwriter cannot release reserved bond or veto a payout by delisting. Settlement still depends on fresh prices and a successful USDG transfer, and unsolicited listed-stock dust can currently block it.

For all timing promises:

> The keeper attempts settlement while it is running; transaction latency, stale prices and failed transfers can delay it. The backtest assumes settlement at the triggering round's price.

### Medium: C02 — increasing timestamps do not authenticate price age

**Locations:** `docs/SECURITY.md:35`, `docs/TECHNICAL.md:142`.

**Proof:** Failing `AuditMoneySafetyTest.testSafety_oldMirrorAnswerCannotBeRetimestampedAsFresh`; `MirrorFeed.push` authenticates the keeper and accepts any positive answer with a strictly newer non-future timestamp. It never authenticates a source round. `keeper/replay.ts` intentionally attaches current timestamps to historical answers.

**Impact:** Readers are told that the keeper cannot disguise an old answer as fresh, although freshness trusts that keeper.

**Smallest fix / exact replacement:**

> `MirrorFeed.push` requires a positive answer and a strictly increasing, non-future timestamp. It does not authenticate the source answer or timestamp: the keeper can submit an old or invented answer with a new timestamp. That authority affects trades, eligibility to settle and payout amounts.

### Medium: C03 — registered accounts do not protect the public replay from outsiders

**Locations:** `docs/SECURITY.md:43`, `docs/TECHNICAL.md:151`.

**Proof:** Failing `AuditMoneySafetyTest.testSafety_untrustedReplayParticipantCannotExtractVenueUSDG`. The test uses public `createOffer`, public `open` and legitimate agent trades around the known replay prices, extracting venue USDG. Passing `testClean_directEOACannotTradeAtVenue` proves the narrower direct-EOA restriction, not admission control.

**Impact:** The stated restriction is presented as protection against the exact arbitrage that permissionless account creation permits.

**Smallest fix / exact replacement:**

> The venue accepts registered Bondline accounts, but anyone can create an offer and account. This is not an admission barrier against trading ahead of the public replay; its team-supplied inventory remains exposed to that arbitrage.

### Medium: C04 — not every decision/refusal has a public receipt, and a hash does not prove AI authorship

**Locations:** `README.md:55`; `web/src/components/landing/NewsStrip.tsx:68`, `web/src/components/landing/Sides.tsx:70`, `web/src/components/landing/ClosingCta.tsx:22`, `web/src/components/landing/Differentiators.tsx:19`; `web/src/components/judge/RealVsDemo.tsx:13`; `docs/TECHNICAL.md:31`, `docs/TECHNICAL.md:101`, `docs/SECURITY.md:49`, `docs/agents.md:73`; `docs/demo-video.md:12`, `docs/demo-video.md:21`, `docs/demo-video.md:51`.

**Proof:** `agents/src/index.ts:162` explicitly keeps hold decisions off-chain. `AgentAccount.trade` hashes arbitrary supplied bytes; the contract does not verify their model, origin or truth. Failing `AuditMoneySafetyTest.testSafety_issuerBlockedTradeStillProducesBlockedReceipt` proves an issuer-blocked otherwise valid trade can revert without a `Blocked` event. Contract rule guards that return normally do emit receipts; not all failures pass through those guards.

**Impact:** Public records can omit holds and transaction failures, and cannot independently establish that a named model generated the reasoning.

**Smallest fix / exact replacement:**

> Submitted trades that complete emit `Traded` or a rule-check `Blocked` receipt with a hash of the submitted decision bytes. Off-chain holds and decisions never submitted are absent, and token or RPC failures may produce no receipt. The hash verifies the bytes, not that a model produced them.

For the NewsStrip comparison:

> Off-chain insurers evaluate agents through tests and monitoring. Bondline exposes submitted decision bytes and completed trade/refusal receipts publicly.

The [linked AIUC funding report](https://dealroom.co/news/150943-aiuc-lands-40m-series-a-to-insure-ai-agents/) describes evaluation/certification; it does not support “insurers can't see what agents do.”

### Low: C05 — no-admin/no-upgrade claims need the protocol boundary

**Locations:** `README.md:23`; `web/src/components/judge/Criteria.tsx:40`, `web/src/components/judge/CantTable.tsx:56`; `docs/TECHNICAL.md:38`, `docs/SECURITY.md:69`.

**Proof:** The deployed protocol bytecode, fixed clone targets and zero EIP-1967 slots support the protocol-only claim. External USDG is an EIP-1967/UUPS proxy; the two Stock Tokens are beacon proxies. The fixed keeper sets price inputs that affect money. See `audit/evidence/deployment-validation.json`, `audit/evidence/deployment-additional.json`, `audit/areas/deployment.md` and C02's failing proof.

**Impact:** A broad security summary can hide issuer upgrades and the keeper's material authority over economic outcomes.

**Smallest fix / exact replacement:**

> Bondline's own contracts are not upgradeable and its markets have no owner. The fixed keeper controls testnet prices, which affect trades and payouts; USDG and Stock Tokens retain issuer controls and upgrade paths.

### Low: C06 — the stock-share limit is a buy check, not a continuous holding ceiling

**Locations:** `README.md:55`; `web/src/components/landing/Differentiators.tsx:15`; `docs/BACKTEST.md:12`, `docs/PRICING.md:113`, `docs/PRICING.md:124`, `docs/demo-video.md:20`.

**Proof:** `AgentAccount.sol:352` checks share after a buy; price appreciation can subsequently raise it. `docs/TECHNICAL.md:96` and `docs/PRICING.md:168` already state this narrower behavior correctly. The backtest holds a basket initialized at 30%/80%; it does not rebalance to those ceilings.

**Impact:** Readers can mistake a trade admission rule for a permanent exposure bound or infer the modeled “worst case” is a continuous contract guarantee.

**Smallest fix / exact replacement:**

> A buy must leave stocks at or below the account's stock-share limit: Careful 30%, Bold 80%. Price changes can subsequently move that share above the limit. Payout liability is capped and reserved independently.

For model/backtest headings: replace “worst case under its rules” with **“reference price at the maximum stock share allowed after a buy”**, and replace “30%/80% stocks” with **“basket initialized at 30%/80% stocks”** where the basket is held fixed.

### Low: C07 — usage-based premiums and two current prices per agent are overstated

**Locations:** `README.md:8`, `README.md:25`; `web/src/components/landing/Hero.tsx:23`, `web/src/components/landing/Hero.tsx:29`; `web/src/components/judge/Criteria.tsx:110`; `docs/PRICING.md:142`, `docs/PRICING.md:148`, `docs/demo-video.md:21`, `docs/demo-video.md:42`, `docs/demo-video.md:60`.

**Proof:** Actual premiums are fixed underwriter-selected `feeBps`, charged once per deposit. Neither contracts nor keeper automatically change them from a record. Both published records have `hasRecord=false`, `trades=0`, `recordBps=null`; current agent pages can show only the rule-based reference price. `shared/src/pricing.ts` returns `record=null` when there is no observed record. Fresh deployed accounts were all cash with no trades at the area-2 snapshot.

**Impact:** The pitch suggests automatic behavioral pricing and current public track records that have not been established.

**Smallest fix / exact replacement:**

> Underwriters set premiums. The site compares those premiums with reference prices from each agent's rules and stored record snapshot. A lower modeled risk does not automatically change an offer's premium. Both team agents currently have only the rule-based reference price; a record price appears after executed trades and a record rebuild.

Replace the Hero pill with **“USDG protection for AI traders.”** For `docs/PRICING.md:148` specifically: **“An agent's lower observed exposure produces a lower reference price under this model; underwriters decide whether to offer a lower premium.”**

### Low: C08 — the pitch says the scripted gap has paid; the deployed book says zero claims

**Location:** `docs/demo-video.md:64`.

**Proof:** `node audit/evidence/claims-current-snapshot.mjs` returned zero `claimsPaid` for all four offers at testnet block **128637073**, timestamp **2026-10-04 15:17:14 IST**. Result: `audit/evidence/claims-current-snapshot.json`. `/judge`, the hero illustration and `docs/ROADMAP.md:9` honestly distinguish the planned claim from a paid one.

**Impact:** A recorded pitch based on this script could claim a successful live payout without a transaction proving one.

**Smallest fix / exact replacement:**

> The contracts are deployed on Robinhood Chain testnet. The scripted gap will be described as paid only after we verify its successful settlement transaction.

This must be rechecked before recording because another session is running the replay.

### Low: C09 — market-hours-only oracle updates are contradicted by the source history

**Locations:** `docs/TECHNICAL.md:135`, `docs/TECHNICAL.md:205`, `docs/SECURITY.md:117`, `docs/BACKTEST.md:120`; rendered caveat from `docs/data/backtest.json:109`.

**Proof:** Fresh mainnet round history at block **79836175** contains **426/1409** normalized TSLA rounds and **307/846** AMZN rounds outside NYSE core hours. Examples include TSLA 23 June **20:18:15** and **22:56:48 New York time**. `python3 audit/evidence/claims-volatility.py` writes `audit/evidence/feed-hours.json`. NYSE's [primary hours/calendar page](https://www.nyse.com/trade/hours-calendars) gives core hours 09:30–16:00 ET. This proves updates outside core hours; it does not claim all extended-session trading is closed.

**Impact:** The timing explanation incorrectly confines price updates and live settlement to the exchange's core session.

**Smallest fix / exact replacement:**

> These feeds include updates outside NYSE core trading hours. In this historical window the longest observed round gaps were 77.8 hours for TSLA and 77.1 hours for AMZN. Settlement waits whenever an included price exceeds the market's maximum age.

### Low: C10 — three numerical/method labels need correction

| Location | Proof and impact | Exact replacement / smallest fix |
|---|---|---|
| `docs/PRICING.md:56` | `fair` applies to net principal, while the gross deposit also contains its premium; existing section 7 and SDK arithmetic correctly distinguish them. | **“`fair` is a share of net principal covered. Multiply by that principal to get dollars.”** |
| `docs/PRICING.md:98` | The stated −15.7%/+14.2% are daily **log returns**. Ordinary close-to-close returns recomputed from the fetched rounds are −14.54446%/+15.28486%. Calling them ordinary “moves” mixes units. See `claims-volatility.json`. | **“The largest daily log returns in the window are retained: TSLA −15.7% on 23 July and AMZN +14.2% on 31 July. Those correspond to close-to-close price changes of −14.5% and +15.3%. Both changes appear throughout the feed history.”** |
| `docs/BACKTEST.md:13` | `scripts/backtest.ts` is a TypeScript simulation of formulas; it does not execute the Solidity contract. The fresh read-only rerun reproduced every stored output. | **“The simulation uses the same payout and reservation formulas, the same loss limit and the same feed history; it does not execute the Solidity contracts.”** |

### Low: C11 — competitor universals and actual use by all account openers are unsupported

**Locations:** `README.md:12`, `README.md:26`; `web/src/components/landing/TheLine.tsx:11`, `web/src/app/(read)/judge/page.tsx:46`, `web/src/components/judge/Criteria.tsx:116`; `docs/demo-video.md:16`, `docs/demo-video.md:48`, `docs/demo-video.md:51`.

**Proof:** The [official Robinhood announcement](https://robinhood.com/us/en/newsroom/hood-summit-2026/) supports more than 150,000 **account openings** and allocation of AI-trading risk to users. It does not prove every opener has let an agent execute a trade. The cited funding announcements do not establish that all other agent bonds pay only rule breaches or that nobody already insures gap risk. See `audit/evidence/external-claims.json`.

**Impact:** The pitch converts supported adoption figures into a stronger usage figure and asserts market-wide exclusivity without evidence.

**Smallest fix / exact replacements:**

> More than 150,000 Robinhood customers have opened agentic trading accounts; Robinhood's disclosure assigns AI-trading risk to users.

> Bondline combines trade-rule checks with capped payouts for market losses beyond a chosen limit.

> Bondline aims to cover a capped part of losses when prices move beyond a selected limit.

Keep the linked $15M seed and $40M Series A figures: the cited reports support them, and $55M is their sum, not proof of underwriting capital or policies sold.

### Low: C12 — the roadmap treats existing permissionless listing and SDK/MCP as absent

**Locations:** `docs/ROADMAP.md:8`, `docs/ROADMAP.md:42`.

**Proof:** `BondlineMarket.createOffer` permits any nonzero agent address; no team-agent allowlist exists. `docs/agents.md:3` correctly says markets are open to outside agents. The existing SDK and six-tool MCP server build unsigned transactions. This same permissionlessness is exercised in C03's failing test.

**Impact:** Present capability is misstated and a purported future admission change already affects the replay's security.

**Smallest fix / exact replacement:**

> Current demonstration covers name the two team agent wallets. The factory already permits offers for any agent address.

Replace milestone 5's heading with **“Self-serve agent pages and expanded SDK/MCP onboarding”** and its deliverable with **“Extend the existing SDK and six-tool MCP server with self-serve agent pages, record rebuilding and reference-price explanations.”**

### Low: C13 — proof capacity and source-of-number wording are too broad

| Location | Proof and impact | Exact replacement / smallest fix |
|---|---|---|
| `README.md:36` | `ProofOfCover.isCovered` returns the cover's **free sale capacity**, not the account's reservation or insured dollar amount. `docs/PROOF_OF_COVER.md:38` correctly explains this. | **“A read-only contract that reports whether an account has active cover, its underwriter, limit and cap, and the cover's free capacity. It does not return the account's reservation.”** |
| `docs/demo-video.md:43` | `/judge` also displays historical tests, model prices and simulated backtests; `RealVsDemo.tsx:14` correctly says this. | **“Market balances and transactions come from the chain; test metrics, reference prices and backtest results come from the named reports and models.”** |
| `docs/agents.md:35` | SDK `quoteCover` checks terms, rule bounds, capacity and optionally balance; it does not read issuer pause/freeze controls. Therefore `problems` cannot list everything execution would refuse. | **“`problems` lists the checked term, rule, capacity and optional balance failures. It does not guarantee execution: issuer pause/freeze controls, changing chain state and token failures may still cause a revert.”** |

### Checked and found clean

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

### Limits

The canonical production URL could not be resolved without environment files, which were not read. Both existing localhost sites return Bondline; the source's fallback Vercel URL returned `DEPLOYMENT_NOT_FOUND`, which is not sufficient to declare the real deployment down. Local builds may use different build-time configuration. Exact third-party legal status, buildathon authorship/provenance, historical agent-model execution and historical verifier independence are not established by source code; those assertions were not silently marked as independently proven. Full Halmos, mutation, deeper invariant, coverage, Slither and Rust/WASM runs were not repeated. The line/section ledger documents all reviewed public copy and these scope limits.


---

## Area 6: continuity after the Mac sleeps

Reviewed 4 October 2026, 15:05 IST. Read-only source inspection; no process was started, stopped or restarted, no deployment was made, and no transaction was sent. Environment files and secret values were not read. The recommendations below are proposals, not executed steps.

### What stops

| Component | On Mac sleep or loss of connectivity | What still exists |
| --- | --- | --- |
| Keeper live mirror | No new mainnet-to-testnet price pushes. | Last on-chain feed rounds. It copies real source timestamps, so fresh-looking weekend prices cannot be manufactured honestly. |
| Keeper replay | No scheduled historical price pushes; after wake it jumps to the current replay time rather than resuming the missed interval. | The frozen replay history and on-chain last round. Missed intermediate prices are not replayed. |
| Keeper settle loop | No automatic scans or settlement transactions. | Anyone with RPC access and gas can still call `settle`; contracts do not run an automatic timer. A breach followed by a rebound while the keeper is offline can be missed, because settlement uses the current price. |
| Keeper scripted gap | No further Friday/weekend/Monday scenario work or record writes. | Saved progress resumes only if its control file and progress file are preserved together. |
| Careful and Bold | No model calls, decisions, trades or new refusal receipts. | Existing token balances and transaction receipts. The accounts remain active unless independently paused/closed/settled. |
| Local Next server | Requests to that server, and any tunnel pointing at it, stop responding. | A separately hosted site can remain online and read public RPCs; an independently deployed web instance was not verified in this area. |
| Claim-letter worker / local post-processing | No new letters, refreshed agent records, or hero snapshot updates. | Previously generated files and all chain events. Backfill is possible later. |

Proof: `keeper/src/index.ts:43`, `:90`, `:107` run mirror/replay/settle/gap loops inside one Node process. `agents/src/index.ts:277` runs both agents inside one Node process. `keeper/src/config.ts:142` derives replay time from elapsed wall-clock seconds; `keeper/src/replay.ts:46` chooses only the currently applicable round, and `:38` stops pushes after the window ends. `keeper/src/replay-data.ts:51` implements the last-round-at-or-before-time lookup. `keeper/src/settle.ts:95` reads current health; it does not replay historical breaches.

Both the recorded configuration and the parent auditor's pinned chain review show a 90,000-second (25-hour) Live price limit and a 300-second Replay limit. Live data can already be stale during the weekend even when the keeper is healthy. The live mirror skips unchanged source rounds (`keeper/src/mirror.ts:26`); moving it to a droplet does not renew those timestamps. Replay agents intentionally stop at the scheduled end (`agents/src/index.ts:109`, `:245`), and do not trade the subsequent scripted gap. Keeping the server awake does not turn an ended replay into ongoing trading.

### Verified operational limitations

#### Medium: restarts can silently choose a different replay schedule unless the runtime record is explicit

**Proof:** selective, non-secret JSON read of `deployments/rhTestnet.json` and `shared/src/deployment.json` on this audit showed `replay.startsAt: null` and `replay.speed: 24` in both. `keeper/src/config.ts:101` normally uses the bundled shared record; `:104` permits an explicit runtime record; `:131` permits environment overrides. `agents/src/config.ts` has the same logic. The other session may be using an override or another deployment record; its effective configuration was not inspected.

**Impact:** copying only the bundles and defaults can leave Replay unscheduled; using `REPLAY_STARTS_AT=now` on the droplet creates a different clock from the running session and the judge site.

**Smallest proposed fix:** preserve the running session's actual absolute `startsAt`, `speed`, window boundaries and deployed addresses in one non-secret runtime JSON file, and point both services' `BONDLINE_DEPLOYMENT` at it. Preserve any session-specific gap output path and control file. Do not infer the active schedule from a stale bundled default, and do not reschedule merely to move hosts.

#### Medium: Mac and droplet workers have no cross-host singleton lock

**Proof:** `keeper/src/txqueue.ts:26` stores its queue and nonce only in memory; `:91` reads the pending nonce on first use. `agents/src/index.ts:277` serializes each local cycle, while `agents/src/trade.ts:68` sends directly through its wallet. No inter-process or inter-host leader lease appears in these execution paths.

**Impact:** two hosts operating the same keeper or agent wallet can race nonces, duplicate model decisions and trigger unpredictable replay/gap sends.

**Smallest proposed fix:** operate exactly one leader for each wallet. Complete the current Mac session or perform one deliberate handoff: stop new work on the old host, reconcile pending transaction receipts/nonces, then enable the droplet services. Do not start the new services while the other Claude session still runs those wallets. A local `flock` wrapper would prevent two copies on the droplet only; it would not protect against the Mac.

#### Low: a live chain view does not automatically refresh every published artifact

**Proof:** `/judge` has 60-second regeneration (`web/src/app/(read)/judge/page.tsx:23`); `/market`, `/live`, `/party` and agent detail use 30-second regeneration. Chain balances and events are read at rendering (`web/src/components/market/data.ts:36`, `web/src/components/live/data.ts:97`). Agent records are bundled (`web/src/components/market/data.ts:65`), the hero imports `web/src/data/gap-demo.json`, and the main gap detail is an eager build-time import (`web/src/components/judge/gap.ts:38`). Letters and party records are filesystem reads (`web/src/lib/letters.ts:23`, `web/src/lib/external/files.ts:17`), gated by `verification/D.json`; Vercel/server-function copies are snapshots listed in `web/next.config.ts:13`.

**Impact:** new settlements can appear in chain totals while the hero, agent history, gap narrative or letters still show an earlier deployment snapshot. An already open browser tab is not refreshed merely by an ISR interval; the countdown updates its own clock, not the page's chain data.

**Smallest proposed fix:** after actual completion, separately regenerate/synchronize the intended read-only artifacts and deploy a fresh web build; colocated mutable letters/party files can be read on later renders without a rebuild. Judges should refresh the page and inspect the displayed block/time. Do not run `scripts/after-replay.sh` as a read-only publishing shortcut: lines 28–29 also run transaction-producing setup steps.

### Smallest proposed droplet setup

Use the existing droplet as one always-on host, with a Node runtime satisfying the repository's `node >=22` requirement, one keeper service and one agents service. If a public web deployment is already independently healthy, those two workers are sufficient for chain activity. If it is not, also run the production Next server from the same release under a service manager and expose it through HTTPS at the confirmed judge URL. A static file server alone is insufficient: the application uses server rendering, route handlers, ISR and filesystem reads. The current public judge domain was not confirmed, so public availability must be checked before calling the migration complete.

1. Transfer the reviewed `keeper/dist/keeper.mjs` and `agents/dist/agents.mjs` as a matched release. These are bundled outputs; they do not need Foundry or a contract rebuild. Transfer the explicit non-secret runtime deployment/session record. For a self-hosted site, transfer its production build, required runtime dependencies and the repository files it actually reads. Set `BONDLINE_REPO_ROOT` to the shared release root if the web working directory differs from `web/`.
2. Preserve the deployed keeper identity and the two deployed agent identities. Supply their secrets privately through root-owned, mode-600 service environment files, without embedding them in bundles or command arguments. Set `BONDLINE_ENV_FILE=none` so a stray project `.env` is not loaded. The agents also need the Anthropic credential; missing credentials cause them to wait without sending (`agents/src/index.ts:104`). Use one shared deployment record and absolute replay clock for both workers.
3. Preserve the active gap's `STATE_DIR/gap.json` and `gap-progress.json`, and any completed gap records. Defaults are `keeper/state/` and `/opt/bondline/deployments/gap-demo.json` when the keeper working directory is `/opt/bondline/keeper` (`keeper/src/gap.ts:49`). Progress is selected only when the saved control matches (`:319`). Do not remove progress, substitute another control or replay Friday during a handoff.
4. Reuse the provided `keeper/deploy/bondline-keeper.service` and `agents/deploy/bondline-agents.service`. They already restart on failure (5 and 10 seconds), load external environment files, and run the bundled files. Choose their documented unprivileged service user and writable state/log directories. The provided units default to root because their `User`/`Group` lines are commented. Enable only after the single-leader handoff is complete.
5. Read-only acceptance checks: both services stay active, startup reports chain 46630 and the expected market/keeper/agent addresses, their effective replay schedules agree, wallet gas balances are nonzero, and RPC/API connectivity works. During an open replay, compare new feed timestamps with source selection and verify real receipts on-chain. During the closed weekend/window, check heartbeat and explicit waiting state instead of demanding artificial fresh prices. Open `/`, `/judge`, `/live` and an account page through the actual external HTTPS URL and check their block/time and stale indicators. None of these acceptance checks require sending a new transaction manually.

Claim letters are optional for live balances/settlements. For continuously appearing new letters on a colocated site, add one supervised read-only `scripts/claim-letters.ts` worker using the existing dependency tree and private Anthropic credential, with its allowed output directory on the same disk. It scans from deployment blocks on restart and skips existing transaction-hash files (`scripts/claim-letters.ts:372`, `:432`). A separately hosted immutable web deployment will not receive droplet-written letters automatically; publish a new snapshot when required. Keeper and agent heartbeats/exit restarts are useful, but the repository does not provide an external failure-alert mechanism or a verified remote uptime guarantee.

### Clean checks and limits

- Existing systemd units have `Restart=always`, network ordering, graceful signal handling and external credential files. Keeper attempts to drain its queue on shutdown (`keeper/src/index.ts:117`).
- Keeper config checks the RPC chain ID and on-chain market USDG; startup verifies all four feeds name the configured keeper. No need to redeploy contracts merely to move the workers.
- Replay source data and price choice are deterministic from the preserved clock; settle account lists and terminal states are reconstructed from the chain after restart. There is no persistent private key in these source files.
- This area did not read environment files, private keys, logs, or process command arguments; it did not inspect the droplet, manipulate services, or confirm a public domain. Existing compiled bundle/source equivalence, current remote service state and effective overrides remain to be confirmed before deployment. No operational change was made.


---

## Consolidated checked-and-clean list

- All 11 deployed protocol runtimes, configured constructor/immutable values, fixed clone targets and local judge balance totals reconcile. No hidden protocol owner, administrator or upgrade mechanism was found. External token issuer/upgrade authority is explicitly scoped.
- All 172 existing Foundry tests passed across the baseline and separate real-token fork runs. The new controls confirm reserved-bond solvency, no second settlement, no agent withdrawal escape, stale/invalid-price rejection and atomic rollback on failed transfers.
- Real USDG domain/payee and one-signature funding paths pass; failed sender substitution does not consume the nonce and successful authorization replay is rejected.
- Every division in `contracts/src` is documented above; reservation and limits round up, payout caps and proportional principal reductions round down. No tested monetary rounding path exceeds the position reservation.
- Root/nested environment, private-directory and log ignore patterns pass for both `.gitignore` and `.vercelignore`. Drip signing-key lookup is server-only; no such reference appears in 3,193 static built files. No actionable literal was confirmed in 7,849 scanned text files; environment files, history and binary/oversize/vendor exclusions are not silently certified.
- The three public web routes validate their non-null address/hash inputs and use fixed/configured outbound destinations; no request-driven SSRF, shell execution or web filesystem-write path was identified. Worker traversal is limited to malformed offline fixture input in the demonstrated proof.
- Fresh model/record tests passed 25/25. Fresh backtest output matches stored numbers after generation metadata is removed. Independently recomputed closes, volatility and replay counts match; all stored model vectors/off-chain rows match current TypeScript. Historical symbolic/mutation/coverage/Slither and actual Rust/WASM runs are separately identified as inspected rather than freshly rerun.
- Existing keeper/agent systemd units already provide restart policies and graceful handling; moving the workers needs no contract redeployment. Actual remote service health, production URL/configuration and a droplet handoff were not performed or certified.

No fix, deployment, automation, service migration, transaction or external message was executed. Source/history/provenance limits and snapshot times are part of the audit's conclusions, not clean-check claims.
