<picture>
  <source media="(prefers-color-scheme: dark)" srcset="web/public/brand/svg/bondline-wordmark-white.svg">
  <img src="web/public/brand/svg/bondline-wordmark.svg" alt="Bondline" height="56">
</picture>

# Bondline

**[Live app](https://bondline-mauve.vercel.app)** · [2 minute tour](https://bondline-mauve.vercel.app/tour) · [Judge kit](https://bondline-mauve.vercel.app/judge) · [HackQuest project](https://arbitrum-singapore.hackquest.io/projects/Bondline)

**USDG protection for AI traders.** Underwriters back AI agents with USDG. Underwriters set premiums. The site
compares those premiums with reference prices from each agent's rules and stored record snapshot. A lower modeled
risk does not automatically change an offer's premium. Past your loss limit, the bond pays the loss beyond it, up to
a 30% drop. Anyone can call `settle`. It stops the agent and pays once only if the required prices are fresh and the
USDG transfer succeeds. USDG pause/freeze controls and unsolicited listed-stock dust can block settlement in the
current code. The user can still stop the agent with `pause` or end cover with `close`. There's no claim form.
Any AI agent can use Bondline through our MCP server or TypeScript SDK ([docs/agents.md](docs/agents.md)): it lists
offers, quotes cover, reads an agent's record and builds unsigned transactions that the agent's own wallet signs.

> The agent bonds we've seen pay when an agent breaks a rule. Ours can't place a trade that breaks its rules;
> Bondline pays when the market breaks through your limit.

Robinhood Chain testnet · Paxos USDG · Robinhood's testnet Stock Tokens · Chainlink prices · two Claude agents.
Testnet, unaudited. A capped, fully backed protection bond, not regulated insurance. Independent project, not
affiliated with Robinhood. Built from scratch during the Arbitrum Open House Singapore buildathon.

## For judges

| Criterion | Proof |
|---|---|
| Smart contract quality | Bondline's own contracts are not upgradeable and its markets have no owner. The fixed keeper controls testnet prices, which affect trades and payouts; USDG and Stock Tokens retain issuer controls and upgrade paths. 172 Foundry tests, all passing ([report](contracts/reports/tests.txt)), incl. fuzz, 8 invariants and 4 fork tests; 100% line coverage ([report](contracts/reports/coverage.md)); Slither 0 High / 0 Medium ([report](contracts/reports/slither.md)); fork tests against the real USDG and Chainlink's live feeds; every contract's source verified on the explorer, as partial matches (the metadata hash differs) ([addresses](deployments/rhTestnet.json)). |
| Product-market fit | Robinhood: "over 150,000 customers have opened agentic trading accounts" and "You assume all risk for trades executed by AI agents" ([HOOD Summit](https://robinhood.com/us/en/newsroom/hood-summit-2026/)). AIUC raised a $15M seed and a $40M Series A to insure agents off-chain ([seed](https://fortune.com/2025/07/23/ai-agent-insurance-startup-aiuc-stealth-15-million-seed-nat-friedman), [Series A](https://dealroom.co/news/150943-aiuc-lands-40m-series-a-to-insure-ai-agents/)). Outside underwriters and buyers are counted on-chain on `/market`. |
| Innovation | A third-party underwriting market for AI traders. Underwriters set premiums. The site compares those premiums with reference prices from each agent's rules and stored record snapshot. A lower modeled risk does not automatically change an offer's premium. Both team agents now have a record price, from executed trades and a record rebuild, as well as the rule-based reference price. |
| Real problem | More than 150,000 Robinhood customers have opened agentic trading accounts; Robinhood's disclosure assigns AI-trading risk to users. A price can gap through your limit, where no stop-loss can sell. Bondline aims to cover a capped part of losses when prices move beyond a selected limit. |
| USDG | Every flow is USDG. Underwriting is one USDG signature and one transaction (EIP-3009 `receiveWithAuthorization`). The issuer's pause and freeze controls are checked and handled. |

Judge kit with every on-chain moment and its transaction: **⟨app⟩/judge**.

Each item below was re-run and checked by an agent that didn't build it (verdicts in [verification/](verification/)):

- **Backtest** ([docs/BACKTEST.md](docs/BACKTEST.md)): hypothetical covers opened at each NYSE close since 23 June and
  run on every Chainlink TSLA and AMZN round. Careful (basket initialized at 30% stocks): 51 covers, 0 claims. Bold
  (basket initialized at 80% stocks): 51 covers, 17 claims, 17.40 USDG paid on 1,000-USDG covers, a 0.82% loss ratio
  at Bold's 4% fee. It does not execute the Solidity contracts. Every assumption is stated.
- **ProofOfCover** ([docs/PROOF_OF_COVER.md](docs/PROOF_OF_COVER.md)): a read-only contract that reports whether an
  account has active cover, its underwriter, limit and cap, and the cover's free capacity. It does not return the
  account's reservation. Deployed at `0x168e27D4A484AA20DEd6bbc0A2272728a9bF4888` (source verified on the explorer
  as a partial match: the metadata hash differs).
- **Agent SDK and MCP server** ([docs/agents.md](docs/agents.md)): an outside agent reads offers, quotes and records,
  builds unsigned cover transactions and trades through its own Bondline account. Five-line quickstart.
- **Rust pricer** ([stylus/](stylus/README.md)): the pricing model in integer Rust for Stylus, equal to the TypeScript
  model on all 16,071 test vectors. Not deployed: Stylus activations are paused on Robinhood Chain (`ArbWasm`
  reports an activation cost of 2^64 − 1), so the agent pages show the deployable program's answers computed
  off-chain, labelled as such.
- **Proofs** ([contracts/reports/proofs.md](contracts/reports/proofs.md)): Halmos symbolic proofs on `BondlineCover`
  (and `BondlineMarket` for the last) for five properties: payout never above the reservation; nothing paid within
  the limit; up to the cap, the user's net loss is the limit; the reservation covers the worst case after every
  deposit and withdraw; the market keeps no USDG. 43 of 48 instances are proven within stated bounds, and 5 timed out
  and are not proven. All 8 invariants hold at 200,000 handler calls each. Mutation testing of `BondlineCover.sol`:
  720 of the 747 mutants that compile are killed; the 27 survivors are judged equivalent by reading the code.
- **Security** ([docs/SECURITY.md](docs/SECURITY.md)): trust assumptions, what each contract can and can't do, and
  known limits.

## How it works

1. **Agents** trade through an `AgentAccount` whose rules they can't change: allowed stocks, size limits, a
   stock-share limit, price age, slippage. A buy must leave stocks at or below the account's stock-share limit:
   Careful 30%, Bold 80%. Price changes can subsequently move that share above the limit. Payout liability is capped
   and reserved independently. Submitted trades that complete emit `Traded` or a rule-check `Blocked` receipt with a
   hash of the submitted decision bytes. Off-chain holds and decisions never submitted are absent, and token or RPC
   failures may produce no receipt. The hash verifies the bytes, not that a model produced them.
2. **Underwriters** create an offer behind an agent with one USDG signature: premium, limit range and bond. Every
   deposit reserves its own worst case first, so no cover is sold without the money to pay it.
3. **Users** pick an offer and a loss limit and deposit USDG. Past the limit, the bond pays the loss beyond it, up
   to a 30% drop. Anyone can call `settle`. It stops the agent and pays once only if the required prices are fresh
   and the USDG transfer succeeds. USDG pause/freeze controls and unsolicited listed-stock dust can block settlement
   in the current code. The user can still stop the agent with `pause` or end cover with `close`. The keeper attempts
   settlement while it is running; transaction latency, stale prices and failed transfers can delay it.

What's demo, and labelled everywhere: the replay market (real Chainlink prices from 28 Sep – 2 Oct, sped up, because
live stock prices are frozen for the weekend), the scripted gap, the demo exchange (testnet Stock Tokens have no
market) and the team-operated wallets. Details in [docs/TECHNICAL.md](docs/TECHNICAL.md).

The scripted gap has paid a real claim on Robinhood Chain testnet. A team-operated test account (100 USDG principal,
10% loss limit, traded by Bold) was invested by real Claude Haiku 4.5 decisions during the replay. The scripted
"Friday close" took it to 92 USDG, an 8% loss inside the limit. The scripted "Monday open" took it to 75 USDG, a 25%
loss against its 10% limit, and the bond paid 15.000001 USDG seconds after the Monday-open price, in block 128646129
on 4 Oct 2026
([settle transaction](https://explorer.testnet.chain.robinhood.com/tx/0xbace67dfa4f25b92eca2f0b2806dc5cf6c9d802608aeee6622fff59cc296087c)).
The user's net loss was exactly the 10 USDG limit. The prices were scripted; the settlement is a real testnet
transaction.

## Repository

| Path | What |
|---|---|
| `contracts/` | Foundry: `BondlineMarket`, `BondlineCover`, `AgentAccount`, `OracleVenue`, `MirrorFeed`, `ProofOfCover`, tests, reports |
| `web/` | The site (Next.js) |
| `keeper/` | Price mirror, replay driver and settle loop |
| `agents/` | Careful and Bold, two Claude Haiku 4.5 agents |
| `shared/` | ABIs, addresses, the pricing model and agent records |
| `sdk/`, `mcp/` | `@bondline/sdk` and `@bondline/mcp`, for agents that aren't ours |
| `stylus/` | The Rust pricer for Stylus (not deployed: activations are paused) |
| `scripts/` | Deploy, setup, records, the backtest and the claim-letter worker |
| `docs/` | [TECHNICAL](docs/TECHNICAL.md) · [PRICING](docs/PRICING.md) · [SECURITY](docs/SECURITY.md) · [BACKTEST](docs/BACKTEST.md) · [PROOF_OF_COVER](docs/PROOF_OF_COVER.md) · [agents](docs/agents.md) · [ROADMAP](docs/ROADMAP.md) · [demo script](docs/demo-video.md) |

```sh
npm install
cd contracts && forge test                     # unit, fuzz, invariant
FORK_TESTS=true forge test --match-path 'test/fork/*'   # real USDG and Chainlink
cd .. && npm run dev                           # the site
```

MIT licensed.
