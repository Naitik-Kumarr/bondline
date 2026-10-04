# Live deployment audit

Audited read-only at Robinhood Chain testnet block **128627492**, hash `0x01dad82600e1d668e3083f53ff4057b4321db12fcc27061f818134f156959f66`, timestamp **4 October 2026, 14:57:36 IST** (`2026-10-04T09:27:36Z`). The public RPC returned chain ID **46630**. No transactions were sent; no processes were restarted; original files and `contracts/out` were read only. Fresh compilation was performed by the money-safety auditor inside `audit/contracts/`.

## Ranked findings

**No deployed-code, constructor, clone-target or bond-balance mismatch was proved.** The observed availability state below is evidence for the operational/claims audit, not a new contract vulnerability. No source-logic finding is asserted without a failing Foundry proof.

## Deployment checks found clean

- All **11 Bondline protocol addresses** in `deployments/rhTestnet.json` have code matching fresh `audit/contracts/out` artifacts: two markets, two venues, four mirror feeds, two implementations and ProofOfCover. The comparison zeros only compiler-declared immutable offsets, compares the entire remaining runtime including metadata, then separately checks **every occurrence of every immutable** against the manifest. The explorer's runtime hashes also equal the pinned RPC hashes. Commands: `node audit/evidence/deployment-probe.mjs`; `node audit/evidence/fresh-build-compare.mjs`; `node audit/evidence/deployment-validate.mjs`. Evidence: `audit/evidence/deployment-snapshot.json`, `fresh-build-compare.json`, `deployment-validation.json`.
- All **nine top-level deployment transaction inputs** exactly match fresh creation bytecode plus decoded constructor arguments. Both OracleVenue instances were created internally by their market constructors; their parent transactions, runtime bytes, `market`, `usdg`, spread and price-age getters were checked separately. The two market constructors use manifest USDG/implementations/assets/feeds, Live age **90000**, Replay age **300**, spread **10 bps**, and the correct labels. Every feed fixes keeper `0x77626a8118AA4a623EEFaB0FD2629ae796e64Ada`, **8 decimals**, and the expected description. ProofOfCover fixes the two correct markets. Command: `node audit/evidence/deployment-additional.mjs`; evidence: `audit/evidence/deployment-additional.json`, `explorer-snapshot.json`.
- All **four cover clones and four account clones** are the exact 45-byte EIP-1167 runtime targeting their respective manifest implementation. The targets have no upgrade path. Source/runtime review confirms no owner/admin/configuration setters on BondlineMarket, OracleVenue or ProofOfCover. All 11 protocol addresses have zero EIP-1967 implementation/admin/beacon slots. Account user controls, cover underwriter controls and the fixed mirror keeper are documented privileged roles, not absent roles. Source review plus matching deployed runtime is the proof; empty proxy slots alone would not establish this.
- `deployments/rhTestnet.json` and `shared/src/deployment.json` agree exactly; the copied audited top-level Solidity sources agree with the original source hashes. Evidence: `deployment-validation.json`.
- The USDG address matches [Paxos's official testnet documentation](https://docs.paxos.com/guides/stablecoin/usdg/testnet). RPC returns **Global Dollar / USDG / 6 decimals**, the shared EIP-712 domain separator `0xb1debe91e09d82163fd9cddaab89359061c0671664e1611258a3c3de7c2d950b`, `paused() == false`, and `isFrozen(address) == false` for all six manifest team wallets. TSLA/AMZN return the expected symbols/names and **18 decimals**. Evidence: `deployment-snapshot.json` and `deployment-additional.json`. The external Stock Token addresses were checked against the manifest, chain identity and explorer verification; current official Robinhood docs expose a mainnet registry and did not independently enumerate these testnet addresses in the retrieved page.
- Explorer reports all 11 protocol addresses verified; they are regular deployments, not upgradeable proxies. Independent runtime/creation comparisons above provide stronger evidence than relying on the explorer verification badge. Public explorer checks are in `explorer-snapshot.json`.

## Balances and displayed numbers

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

## Observed availability and trust boundaries

At the pinned block, both Live feeds are stale (**135125 / 135379 seconds old**, versus **90000** allowed). This is consistent with the declared weekend limitation. Both Replay feeds are also stale (**42171 / 42168 seconds old**, versus **300** allowed), with last pushes around **03:15 IST**. In that state, fresh-price trades fail, and a stock-holding account cannot settle from those stale prices. The four audited accounts currently hold only cash, so this does not presently conceal a loss payout. The parallel replay session may change this state; it must be checked again before describing the demo as trading live. Proof is the pinned `latestRoundData` RPC results in `deployment-snapshot.json`, not an assumption about whether a process exists.

The protocol's no-upgrade claim must be scoped to **Bondline's own contracts**. External USDG is an **EIP-1967 proxy** whose implementation at the audited block is `0xF0863D7A29a55d0c4263c11bFac754312ff078DF`. TSLA and AMZN are **beacon proxies**, both using beacon `0x1DF3Ca0FD30ED5Eeb09Eb01938f4e9c5196e6Ca5`. Their issuer upgrade/control surfaces are outside the Bondline build. Zero EIP-1967 admin storage on a UUPS token does not mean it lacks upgrade authority. MirrorFeed's fixed keeper controls every positive price pushed to its feed; immutable keeper does not authenticate a Chainlink price.

## Limitations

The public fallback domain named in `web/src/app/layout.tsx`, `https://bondline-mauve.vercel.app`, returned **HTTP 404 / DEPLOYMENT_NOT_FOUND** on `/judge` and `/market`. This proves that fallback URL is unavailable; it does **not** prove an unknown environment-resolved production deployment is offline. No canonical/`og:url` identifying a different public domain was present in the captured local judge HTML; port 3110's HTML used the fallback domain. The local pages were verified, but a current independently accessible public site URL was not established without reading private configuration. Evidence: `audit/evidence/judge-live-response.http`, `judge-live.txt`, `market-live.txt`.

No attempt was made to pause/freeze USDG, push a keeper price, mutate balances, exercise external token upgrades, or send any test transaction to the live chain. The token's own implementation is externally supplied and was not built as a Bondline source contract. Fork/source behavior belongs to the money-safety proof tests.
