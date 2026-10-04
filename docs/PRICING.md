# How Bondline prices cover

> **A reference price from a simple published model, not actuarial.**
> Underwriters set their own premiums. The model gives a price anyone can compare a premium against.

The code is `shared/src/pricing.ts` (the model), `scripts/volatility.ts` (σ) and `shared/src/record.ts` (the record
and score). Every number below comes from that code. Section 9 shows how to reproduce them.

## 1. What the price is for

A covered account has a loss limit, L. Once its loss passes L, anyone can call `settle`. It stops the agent and
pays once only if the required prices are fresh and the USDG transfer succeeds. USDG pause/freeze controls and
unsolicited listed-stock dust can block settlement in the current code. The user can still stop the agent with
`pause` or end cover with `close`. A settlement pays the loss beyond L at that moment, up to a 30% drop. So the bond
pays at most `band = 30% − L` of the principal.

If prices moved smoothly and settlement happened right at the limit, the bond would pay almost nothing. The keeper
attempts settlement while it is running; transaction latency, stale prices and failed transfers can delay it. The bond
pays real money when a price **jumps** through the limit: a weekend or overnight gap, or news. The model prices
that gap, plus the cost of keeping the bond's reserve locked.

## 2. The model

```
w     = share of the account in stocks
σ     = annual volatility of the most volatile allowed stock
σa    = w × σ
T     = the cover's term in years: 30 days on the board, so T = 30/365
L     = limit;  band = cap − limit;  cap = 30%
P     = min(1, 2 × N(−L / (σa × √T)))      chance the account touches its limit (zero drift)
gap   = min(band, 0.5826 × σa × √g)        expected overshoot when a price jump crosses the limit
fair  = 2 × P × gap  +  band × r × T
```

| Input | Value | What it means |
|---|---|---|
| w | from the agent's rules or record | Share of the account's value held in stocks. Cash doesn't move. |
| σ | TSLA 54.57% a year (section 3) | Volatility of the most volatile stock the account may trade. |
| σa | w × σ | Volatility of the whole account. |
| T | 30/365 years | The board quotes 30 days of cover. |
| L | e.g. 10% | The buyer's loss limit. |
| cap | 30% | Cover pays down to a 30% drop. |
| g | 1.5/252 years | The variance of one weekend gap: about 1.5 trading days. A stated assumption. |
| 0.5826 | −ζ(1/2)/√(2π) | Overshoot constant of a Gaussian random walk (Siegmund; Broadie, Glasserman and Kou). |
| 2 | loading | A stated loading for fat tails: real jumps are bigger than a normal walk's. |
| r | 5% a year | A stated cost of the reserve the bond must lock. |
| N | normal CDF | Hart's double-precision rational approximation. Error against erfc: below 1e-15 absolute. |

In words:

- **P** is the chance that the account's value touches its limit within the term, if it moves like a random walk with
  no drift and volatility σa. This is the reflection principle.
- **gap** is how far past the limit the account lands when a jump carries it through. A walk that crosses a barrier
  overshoots it by 0.5826 times one step's standard deviation on average. One step here is a weekend: σa × √g.
  It can't exceed the band, because the cover never pays more.
- **2 × P × gap** is the chance of reaching the limit times the average payout when it does, doubled for fat tails.
- **band × r × T** is what it costs the underwriter to lock the worst case for the term. The contract reserves
  `net × (cap − limit)` of the bond (rounded up) for every deposit, and refuses the deposit if the free bond can't.

`fair` is a share of net principal covered. Multiply by that principal to get dollars.

### Sanity values

L = 10%, cap 30%, 30 days, σ = 50%:

| w | P | gap | 2 × P × gap | reserve part | fair |
|---|---|---|---|---|---|
| 50% | 16.29% | 112.4 bps | **36.6 bps** | 8.2 bps | 44.8 bps |
| 100% | 48.54% | 224.7 bps | **218.2 bps** | 8.2 bps | 226.4 bps |

The unit tests check these (about 37 bps, 218 bps and 8 bps), plus ten fixed vectors in `PRICING_VECTORS`. The
vectors' expected values were computed separately in Python with `math.erfc`. Inputs are in basis points and days, so
a port of the model (for example in Rust) can reuse them.

## 3. σ and where it comes from

σ is the realised volatility of each stock, from **Chainlink's own price history on Robinhood Chain mainnet**:

| Stock | Feed (Robinhood Chain mainnet, chain id 4663) | On-chain description | σ (annual) | 95% range |
|---|---|---|---|---|
| TSLA | `0x4A1166a659A55625345e9515b32adECea5547C38` | RHTSLA / USD | **54.57%** | 46.8% – 65.4% |
| AMZN | `0xD5a1508ceD74c084eBf3cBe853e2C968fB2a651C` | Robinhood AMZN / USD | **39.32%** | 33.8% – 47.1% |

The markets list TSLA and AMZN. TSLA is the more volatile, so the model uses **σ = 54.57%** unless an account's
rules allow AMZN only.

How it's computed (`scripts/volatility.ts`, output in `shared/src/volatility.json`):

1. Read every round of each feed with `getRoundData`, walking back from `latestRoundData`. Both feeds are in phase 1.
   TSLA has 1,446 rounds and AMZN 872, from 22 June 2026 to 2 October 2026. None are missing.
2. Take one close per NYSE trading day: the feed's answer at 16:00 New York time, which is the last round at or
   before the close. Weekends and NYSE holidays (3 July and 7 September 2026) are skipped. The feeds published no
   rounds on those two holidays.
3. Use the longest clean window: **23 June to 2 October 2026, 72 closes, 71 daily returns.** Every close in it comes
   from a round at most 6.2 hours old.
4. σ = the sample standard deviation of the daily log returns, times √252.

Why the window starts on 23 June: the feeds' first rounds, from 22 June 00:00 UTC until 23 June around 13:45 UTC
(TSLA rounds 1–37, AMZN rounds 1–26), report answers about 10^8 times too large, with 16 decimals while `decimals()`
says 8. That is a unit error, not a price move. No return in the window spans it.

The largest daily log returns in the window are retained: TSLA −15.7% on 23 July and AMZN +14.2% on 31 July. Those
correspond to close-to-close price changes of −14.5% and +15.3%. Both changes appear throughout the feed history.

**Caveats.** The history is short: 71 returns, about 3.3 months. The 95% range above shows how loose that is; it
assumes normal returns, so the true range is wider. A close can differ from the exchange's official close by up to
about 0.5%, because the feeds update on a 0.5% move or every 24 hours. Realised volatility looks back; it is not a
forecast.

An independent recomputation from the same rounds (Python, outside the repo) gave the same values: 0.5457 and 0.3932.

## 4. Worked examples: Careful and Bold

L = 10%, 30 days, σ = 54.57% (TSLA). Each agent's reference price at the maximum stock share allowed after a buy:

| | Careful (w = 30%) | Bold (w = 80%) |
|---|---|---|
| σa = w × σ | 16.37% | 43.66% |
| L ÷ (σa √T) | 2.131 | 0.799 |
| P, chance to touch the limit in 30 days | 3.31% | 42.43% |
| gap, expected overshoot | 73.6 bps | 196.2 bps |
| risk part, 2 × P × gap | 4.9 bps | 166.5 bps |
| reserve part, 20% × 5% × 30/365 | 8.2 bps | 8.2 bps |
| **fair** | **13.1 bps (0.13%)** | **174.7 bps (1.75%)** |
| per $1,000 covered | $1.31 | $17.47 |

For Careful, the reserve cost is most of the price: with 30% in stocks, a 10% loss needs a 33% fall in its stocks.
For Bold, the gap risk dominates. A buy must leave stocks at or below the account's stock-share limit: Careful 30%,
Bold 80%. Price changes can subsequently move that share above the limit. Payout liability is capped and reserved
independently.

The same two agents at other limits (fair, bps, 30 days):

| L | Careful (w = 30%) | Bold (w = 80%) |
|---|---|---|
| 5% | 52.5 | 280.9 |
| 10% | 13.1 | 174.7 |
| 15% | 6.4 | 96.7 |
| 20% | 4.1 | 47.3 |

How much σ matters: at the ends of TSLA's 95% range (46.8% and 65.4%), Careful's price is 9.9–21.5 bps and Bold's
126.7–245.7 bps. An account whose rules allow AMZN only (σ = 39.32%) would price at 8.5 bps (w = 30%) and 83.9 bps
(w = 80%).

## 5. Two reference prices per agent

Underwriters set premiums. The site compares those premiums with reference prices from each agent's rules and stored
record snapshot. A lower modeled risk does not automatically change an offer's premium. Each agent's record carries
two reference prices, both at L = 10% and 30 days:

- **Reference price at the maximum stock share allowed after a buy**: w = the rules' maximum stock share. It comes
  from the stock-share cap in the account rules seen on-chain (`Opened` events), or the offer's `terms.maxStockBps`
  if there are no accounts yet.
- **Its record**: w = the agent's observed exposure, the 95th percentile of its stock share (section 6).

An agent's lower observed exposure produces a lower reference price under this model; underwriters decide whether to
offer a lower premium.

Both team agents now have a record price, from executed trades and a record rebuild, as well as the rule-based
reference price (`shared/src/records/index.json`): Careful 8.2 bps on its record (1 trade) against 13.1 bps from its
rules; Bold 174.9 bps on its record (4 trades, 1 claim) against 174.7 bps from its rules.

Fair price against w (σ = 54.57%, L = 10%, 30 days):

| w | P | gap (bps) | risk (bps) | reserve (bps) | fair (bps) |
|---|---|---|---|---|---|
| 0% | 0.00% | 0.0 | 0.0 | 8.2 | 8.2 |
| 10% | 0.00% | 24.5 | 0.0 | 8.2 | 8.2 |
| 20% | 0.14% | 49.1 | 0.1 | 8.2 | 8.4 |
| 30% | 3.31% | 73.6 | 4.9 | 8.2 | 13.1 |
| 40% | 11.00% | 98.1 | 21.6 | 8.2 | 29.8 |
| 50% | 20.11% | 122.6 | 49.3 | 8.2 | 57.5 |
| 60% | 28.67% | 147.2 | 84.4 | 8.2 | 92.6 |
| 70% | 36.12% | 171.7 | 124.0 | 8.2 | 132.2 |
| 80% | 42.43% | 196.2 | 166.5 | 8.2 | 174.7 |
| 100% | 52.27% | 245.3 | 256.4 | 8.2 | 264.6 |

For example (an illustration from this table, not an agent's record): rules allowing 80% price at 174.7 bps. A record
with a 95th percentile of 50% would price at 57.5 bps, 117.2 bps less.

The rules cap the stock share only when the agent buys. If stocks rise afterwards, the share can drift above the cap,
so an agent's record price can sometimes exceed its rule-based reference price, as Bold's does now. The record shows
this as it is.

## 6. The record and the score

`npm run record <agent>` rebuilds an agent's record from chain events on both markets, Live and Replay. It writes
`shared/src/records/<agent>.json` and a summary in `shared/src/records/index.json`, which the site reads at build time.
The logic is in `shared/src/record.ts`; it is unit-tested on synthetic events.

What it reads, from each market's deploy block, in 10,000-block chunks:

- `OfferCreated` on the market: the offers whose `terms.agent` is this agent.
- `Opened`, `Deposited`, `Withdrawn`, `Settled`, `Closed` on those offers' covers: the agent's covered accounts and claims.
- `Traded` and `Blocked` on those accounts: trades and refusals, by reason.
- `AnswerUpdated` on the market's price feeds: revaluations between trades.

What it measures:

- **Trades and refusals**, refusals counted by reason (`BLOCK_REASONS`).
- **Time active**: from the agent's first on-chain trade or refusal to its latest. On the Replay market, prices run
  400 times faster than real time.
- **Exposure**: the share of account value in stocks. One observation after every trade (`stockValueAfter ÷
  valueAfter` from the `Traded` event). One more for every active covered account at every price update on its
  market: the holdings implied by its trades (stock bought minus sold), valued at the new price, plus cash (deposits
  minus withdrawals, plus sales minus purchases). The record uses the 95th percentile, nearest rank. Tokens sent to an
  account outside deposits and trades are ignored.
- **Worst drawdown against the limit**: `(principal − value) ÷ principal`, at the same observations and at settlement,
  divided by that account's limit. 1.0 means it reached its limit.
- **Claims**: every `Settled` event, with the loss, the limit and the payout.

### The score (0–100, for display)

```
score = exposure + drawdown + claims + history, rounded

exposure = 40 × (1 − p95 exposure ÷ rules' max stock share)      0 to 40
drawdown = 30 × (1 − worst drawdown ÷ that account's limit)      0 to 30
claims   = 10 × (1 − accounts paid a claim ÷ covered accounts)   0 to 10
history  = 20 × min(1, on-chain decisions ÷ 100)                 0 to 20
```

- Each part is clamped to its range. On-chain decisions are trades plus refusals.
- An agent with no trades has **no record**: no score and no record price.
- Exposure is judged against the agent's own rules, so a careful agent and a bold one are each scored on how much of
  their allowance they use. The absolute risk is in the prices, not the score.
- The score is for display only. It doesn't set any price.

## 7. Limitations

- The model is simple on purpose. It is a reference, not an actuarial price, and no one has audited it.
- It assumes zero drift and a constant σ, estimated from 71 daily returns.
- It applies the most volatile allowed stock's σ to the whole stock share. This ignores the diversification between
  TSLA and AMZN, which leans high.
- It treats every touch of the limit as if a weekend-sized gap carried it through. A touch during trading hours
  that is settled promptly has a smaller overshoot, so this part leans high too. The keeper attempts settlement while
  it is running; transaction latency, stale prices and failed transfers can delay it. Real jumps have fatter tails
  than a normal walk, which leans low; the ×2 loading is a stated guess for that, not a fitted number.
- It holds w fixed for the term. Agents trade, which is why the record measures w from the chain.
- The contract charges the premium once per deposit, and cover lasts until the account is settled or closed. The
  model prices 30 days of cover, as the board does.
- The contract takes the premium from each deposit, while the model prices the amount covered (the deposit less the
  premium). The difference is the price times the premium rate: 1% of the price at a 1% premium.
- Records on the Replay market come from real prices sped up, plus a scripted gap. The record can't tell scripted
  prices from live ones, but it tags every account, claim and action with its market.

## 8. References

- D. Siegmund, "Corrected diffusion approximations in certain random walk problems", *Advances in Applied
  Probability* 11(4), 1979: the overshoot constant −ζ(1/2)/√(2π) ≈ 0.5826.
- M. Broadie, P. Glasserman and S. Kou, "A continuity correction for discrete barrier options", *Mathematical
  Finance* 7(4), 1997: the same constant, applied to discretely monitored barriers.
- J. F. Hart, *Computer Approximations*, 1968, and G. West, "Better approximations to cumulative normal functions",
  *Wilmott Magazine*, 2005: the normal CDF.
- NYSE holidays and trading hours: nyse.com/markets/hours-calendars.
- Chainlink Data Feeds on Robinhood Chain mainnet: the two feed addresses in section 3.

## 9. Reproduce

```
npx tsx scripts/volatility.ts                # σ from Robinhood Chain mainnet → shared/src/volatility.json
npm run test:model                           # the model's unit tests and fixed vectors
npx tsx --test shared/src/record.test.ts     # the record and score, on synthetic events
npm run record careful bold                  # records from the chain, once the markets are deployed
```
