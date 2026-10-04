# Bondline roadmap

Prizes and grants in this program are paid against milestones, so each step below has deliverables and the KPIs
we would report. Every KPI is read from the chain: USDG bonded, cover sold, claims paid, loss ratio (claims paid ÷
premiums earned), agents listed, and independent underwriters. Where a number is a target, it says so.

Today (testnet, 4 Oct 2026): two markets on Robinhood Chain testnet (Live and Replay), one-signature underwriting
in USDG, covered accounts that only the cover's agent can trade, inside on-chain rules, and a keeper that pushes
prices and attempts to settle accounts past their limit while it is running. Current demonstration covers name the
two team agent wallets. The factory already permits offers for any agent address. Covers have no fixed term today: a
cover runs until the user closes it or it pays out. Team-operated wallets are labelled; outside activity is counted
separately.

The first claim has paid, on the Replay market's scripted gap: a team-operated test account went from 92 to 75 USDG,
a 25% loss against its 10% limit, and the bond paid 15.000001 USDG seconds after the Monday-open price, so the user's
net loss was the 10 USDG limit
([settle tx](https://explorer.testnet.chain.robinhood.com/tx/0xbace67dfa4f25b92eca2f0b2806dc5cf6c9d802608aeee6622fff59cc296087c),
block 128646129).

An independent review on 4 Oct 2026 ([audit/AUDIT.md](../audit/AUDIT.md)) proved no Critical finding. Its open
contract findings come first (milestone 1), then fixed-term covers (milestone 2). [SECURITY.md](SECURITY.md)
section 6 lists every finding with its status and proof.

## 1. Fixes from the independent review, before any mainnet beta

- **Deliverables:** each open finding fixed, and its failing test in
  [audit/contracts/test/AuditMoneySafety.t.sol](../audit/contracts/test/AuditMoneySafety.t.sol) passing.
  - **M01, stock dust:** a holding that values to zero no longer controls price freshness, so unsolicited dust cannot
    block a claim or a cash withdrawal; plus a narrow owner sweep for unsolicited or disallowed tokens during active
    cover that cannot move covered assets.
  - **M02, replay admission:** only admitted participants can trade on the historical Replay venue, or each gets its
    own inventory. A registered account alone is not an admission check.
  - **M03, paginated offers:** offers are read in bounded pages; the keeper and the site process them in batches and
    skip inactive or unfunded offers.
  - **M04, payment readiness:** `health` reports whether a payout can be paid now (USDG not paused, recipient not
    frozen) apart from whether the loss qualifies, and the site and keeper check it before offering or sending a
    settle.
  - **M05, receipt wording:** receipt claims cover completed rule-check refusals only, or an isolated path records a
    `Blocked` receipt for issuer-blocked trades without breaking atomic accounting.
  - **Production dependencies (W1), planned:** PostCSS 8.5.18 or later and `ws` 8.21.0 or later, then a normal build
    and a wallet check.
  - **Drip (S-1), planned:** an atomic, durable budget reservation shared by every server instance. Today the drip
    wallet's balance, at most one day's budget, is the hard cap.
- **KPIs:** open High and Medium findings from the review (target 0); the seven failing review tests behind M01 to
  M05 pass (target 7 of 7). The two other failing tests describe the testnet keeper's power over prices, which
  milestone 4 removes.

## 2. Fixed-term covers

- **Deliverables:** covers with an end date. Today a cover has no term on-chain: it runs until the user closes it or it
  pays out, while the premium is charged once, so a long hold is more risk for the same premium (the backtest's "held
  until the window ends" sensitivity shows it, [BACKTEST.md](BACKTEST.md)). A fixed term lets the premium and the
  reference price (30 days on the board) describe exactly what is sold; the cover ends and frees its reserve at its
  end date, with renewal as a new cover.
- **KPIs:** share of covers with a fixed term; average reserve-days per premium; loss ratio by term.

## 3. Audit and the Arbitrum Security Program

- **Deliverables:** an external audit of `BondlineMarket`, `BondlineCover`, `AgentAccount`, `OracleVenue` and
  `MirrorFeed`; every finding fixed or answered in public; an application to the Arbitrum Security Program; a bug
  bounty on the testnet deployment.
- **KPIs:** open High and Medium findings (target 0); outside testnet underwriters and buyers, counted on-chain.

## 4. A capped mainnet beta on Robinhood Chain, in USDG, after legal review

- **Deliverables:** legal review of the product's structure (a capped, fully backed protection bond) before any
  mainnet use; markets that read Chainlink's TSLA and AMZN feeds directly (no keeper-pushed prices, as in our
  mainnet-fork test); Robinhood's mainnet Stock Tokens with a real execution venue instead of the demo exchange;
  hard caps per cover, per offer and in total.
- **KPIs:** USDG bonded, cover sold, claims paid, loss ratio, number of agents and underwriters.

## 5. Pooled underwriting: a USDG vault that backs many agents

- **Deliverables:** a vault where many underwriters deposit USDG and the vault backs many agents, with per-agent
  exposure limits and the same per-deposit reservation rule the covers use today.
- **KPIs:** USDG in the vault, agents backed, largest single-agent exposure as a share of the vault, loss ratio.

## 6. Self-serve agent pages and expanded SDK/MCP onboarding

- **Deliverables:** Extend the existing SDK and six-tool MCP server with self-serve agent pages, record rebuilding and
  reference-price explanations.
- **KPIs:** agents listed, decisions recorded, share of trades whose decision bytes match their on-chain hash, cover
  sold per agent.

## 7. The protocol's cut of premiums

- **Deliverables:** a small, capped protocol fee on premiums, visible on every offer; Bondline itself never pays
  claims.
- **KPIs:** premiums earned, protocol revenue, loss ratio by agent.
