# Bondline demo video (3 minutes) and pitch (75 seconds)

Screen recording of the live site on Robinhood Chain testnet, with a voice-over. Every on-chain step shown is a real
testnet transaction; say "testnet" once at the start and keep the labels on screen (Replay market, scripted gap,
team-operated). Pace: about 150 words a minute. Words in quotes are spoken; the rest is what's on screen.

**The claim, checked on-chain on 4 Oct 2026.** Settle transaction
[`0xbace67df…087c`](https://explorer.testnet.chain.robinhood.com/tx/0xbace67dfa4f25b92eca2f0b2806dc5cf6c9d802608aeee6622fff59cc296087c),
block 128646129, 15:36:39 IST, status success, sent by our keeper. `claimsPaid()` on the Replay cover
`0x0b7BAaE5c0c19438a90D35A61D1700E6CfCB8330` is 15000001 (15.000001 USDG). The account
`0xB792735F30906101a95Bc4e9dca4fd0f1193eBEa` is a team-operated test buyer: 100 USDG principal, a 10% loss limit,
traded by Bold. Real Claude Haiku 4.5 decisions invested it during a replay of the real 28 Sep – 2 Oct Chainlink
prices at 400x (15:12:16 to 15:30:16 IST; Bold made 4 trades, Careful 1). Then the scripted gap: "Friday close" at
92 USDG (8% loss, inside the limit), a 6-minute "weekend" with no prices, and "Monday open" prices at 15:36:32 (TSLA)
and 15:36:35 (AMZN) IST, taking it to 75 USDG (25% loss). The bond paid 15.000001 USDG 4 to 7 seconds later; the
user's net loss is exactly the 10 USDG limit.

## The 3-minute demo

**0:00–0:18 · The problem (landing page, news strip)**
"This is Bondline, on Robinhood Chain testnet. More than 150,000 Robinhood customers have opened agentic trading
accounts; Robinhood's disclosure assigns AI-trading risk to users. Off-chain insurers evaluate agents through tests
and monitoring. Bondline exposes submitted decision bytes and completed trade and refusal receipts publicly."
On screen: the landing page, then the news strip with its linked sources.

**0:18–0:38 · The gap (hero animation)**
"A stop-loss can't sell inside a gap: over a weekend, overnight or on news, the price jumps through your limit. The
agent bonds we've seen pay when an agent breaks a rule. Ours can't place a trade that breaks its rules; Bondline pays
when the market breaks through your limit."
On screen: the hero animation.

**0:38–1:11 · The board (/market, then Bold's agent page)**
"Two AI agents, both Claude, trade inside on-chain rules. A buy must leave stocks at or below the account's
stock-share limit: Careful 30%, Bold 80%. Price changes can subsequently move that share above the limit. Submitted
trades that complete emit a Traded or a rule-check Blocked receipt, with a hash of the submitted decision bytes.
Off-chain holds and decisions never submitted are absent, and token or RPC failures may produce no receipt. The hash
verifies the bytes, not that a model produced them."
On screen: /market, then Bold's page. Show one of its 4 trades and click Verify: the decision bytes re-hash to the
hash in the on-chain receipt. Both records show 0 refusals today, so don't promise a refusal on screen.

**1:11–1:40 · Underwrite with one signature (/underwrite)**
"Now I'm an underwriter. Underwriters set premiums. The site compares those premiums with reference prices from each
agent's rules and stored record snapshot, and both agents now have a record price. A lower modeled risk does not
automatically change an offer's premium. I back Careful at a 1% premium, with a bond. One USDG signature, one
transaction, and the offer is live. The contract won't sell more cover than this bond can pay."
On screen: each agent's record price and rule-based reference price, for 30 days of cover. Careful: record price
8.2 bps (1 trade), rule-based 13.1 bps. Bold: record price 174.9 bps (4 trades, 1 claim), rule-based 174.7 bps.
Then the terms (1% premium, limits from 5 to 20%, a bond), one signature in the wallet and the one transaction.

**1:40–1:56 · Buy cover (/cover)**
"Now I'm a user. I pick the offer, a 10% loss limit and my rules, and deposit USDG. Before I sign, it checks that
USDG isn't paused and my wallet isn't frozen. I approve exactly the deposit, never unlimited."
On screen: the checks list and the exact premium, then the wallet approval for exactly the deposit.

**1:56–2:45 · The gap and the claim (/account for 0xB792…eBEa, then the explorer)**
"Real Claude decisions invested this team-operated test account, 100 USDG with a 10% loss limit, during a replay of
real Chainlink prices from 28 September to 2 October, sped up 400 times. Then the scripted gap. Friday close: 92
USDG, an 8% loss, inside the limit. A six-minute weekend pushes no prices. Monday open: 75 USDG, a 25% loss against
a 10% limit. Seconds later, our keeper settled: trading stopped, the bond paid 15.000001 USDG, and the user's net
loss was exactly the 10 USDG limit. Anyone can call settle. It pays only if the required prices are fresh and the
USDG transfer succeeds; USDG pause and freeze controls and unsolicited stock dust can block it in the current code."
On screen: keep "Replay market", "scripted gap" and "team-operated" visible. Then the settle transaction on the
explorer, with its link on screen for the rest of the scene: block 128646129, 15:36:39 IST, sent by our keeper,
15.000001 USDG paid.
https://explorer.testnet.chain.robinhood.com/tx/0xbace67dfa4f25b92eca2f0b2806dc5cf6c9d802608aeee6622fff59cc296087c

**2:45–3:00 · Close (/judge)**
"Market balances and transactions come from the chain; test metrics, reference prices and backtest results come from
the named reports and models. Bondline: USDG protection for AI traders, on Robinhood Chain. Testnet
and unaudited."
On screen: /judge.

Spoken words: 446 (about 2 minutes 58 seconds at 150 words a minute).

## The 75-second pitch

"More than 150,000 Robinhood customers have opened agentic trading accounts; Robinhood's disclosure assigns
AI-trading risk to users.

The agent bonds we've seen pay when an agent breaks a rule. Ours can't place a trade that breaks its rules; Bondline
pays when the market breaks through your limit.

When a price gaps through your loss limit, a stop-loss can't sell. Anyone can call settle. It stops the agent and
pays the loss beyond your limit, up to a 30% drop, from an underwriter's USDG bond, only if the required prices are
fresh and the USDG transfer succeeds. USDG pause and freeze controls and unsolicited stock dust can block it in the
current code.

Underwriters set premiums with one USDG signature; the contract never sells more cover than the bond can pay.

On Robinhood Chain testnet, a scripted gap on the Replay market took a team test account, invested by real Claude
decisions, from 92 to 75 USDG: a 25% loss against a 10% limit. Seconds after the Monday-open price, the bond paid
15.000001 USDG. Next: fixes from today's independent review, an external audit, then a capped mainnet beta."

On screen, if the pitch is filmed: the settle transaction link above.

Spoken words: 187 (about 75 seconds at 150 words a minute).
