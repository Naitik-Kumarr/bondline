# Bondline agents

One process, two AI personas on Claude Haiku 4.5 (`claude-haiku-4-5-20251001`), each with its own wallet:

- **Careful**: keeps at most 30% of an account in stocks; small trades.
- **Bold**: up to 80% in stocks.

The on-chain rules of each covered account are what bind them; the persona prompt states the caps.

Every `AGENT_INTERVAL_SECONDS` (default 180), for each persona, in both markets: find the offers whose agent is the
persona's address and their covered accounts; skip accounts that aren't Active, are paused or stopped; skip the market
unless every feed's price is fresh for both the market's and the account's `maxPriceAge` (with up to 60 s headroom).
The replay market is traded only while the replay runs (`REPLAY_STARTS_AT`), so the agents never trade on stale or
scripted prices. Then:

1. gather the state from the chain: value, cash, holdings, share in stocks, principal, loss and limit (`health`), rules,
   today's volume, the largest trades the rules allow now, and recent price changes from the feeds' rounds;
2. ask Claude for one decision as strict JSON (structured output, validated):
   `{"action": "buy"|"sell"|"hold", "asset": "TSLA"|"AMZN", "usdAmount": number, "reason": string}`;
3. hold: logged, nothing on-chain. Buy or sell: `minOut` from the demo exchange's quote less `MIN_OUT_TOLERANCE_BPS`,
   then `account.trade(asset, isBuy, usdAmount, minOut, decision)`, where `decision` is the UTF-8 bytes of a compact
   canonical JSON (sorted keys, under 800 bytes): `v`, `agent`, `model`, `market`, `account`, `ts`, `action`,
   `asset`, `usdAmount`, `reason`, key `inputs` (value, cash, stock share, prices, loss, limit, caps, market time),
   and on a retry `retry: {refused, prev}`. The `Traded`/`Blocked` event carries its keccak256;
   `npm run verify-decision -w @bondline/agents -- 0x<tx>` re-hashes the transaction input and checks it;
4. a `Blocked` trade (read from the receipt) is retried at most once, re-deciding with the refusal reason (not for
   Stopped, Paused or PriceStale). Never more.

Spend safety: `max_tokens` 300, at most `MAX_CLAUDE_CALLS_PER_HOUR` calls (default 60, both personas together), a
startup line saying whether `ANTHROPIC_API_KEY` is set (never its value). Without the key the agents log and wait. An
auth, permission, bad-request or unknown-model error disables model calls until restart; a 429 pauses them for 2
minutes. Set a spend limit on the Anthropic key as well.

`MOCK_DECISIONS=1` uses deterministic scripted decisions labelled `"model": "mock"` for pipeline tests (each persona's
script includes one deliberate rule break, to exercise a refusal and the single retry). **It refuses to run on any
chain but Anvil (31337).**

Logs: JSON lines on stdout and in `logs/agents.log`.

## Environment

| Variable | Default | |
|---|---|---|
| `CAREFUL_PRIVATE_KEY`, `BOLD_PRIVATE_KEY` | at least one | each persona's wallet (needs testnet ETH for gas) |
| `ANTHROPIC_API_KEY` | | without it the agents wait |
| `AGENT_MODEL` | `claude-haiku-4-5-20251001` | |
| `AGENT_INTERVAL_SECONDS` | 180 | |
| `MAX_CLAUDE_CALLS_PER_HOUR` | 60 | hard cap |
| `CLAUDE_MAX_TOKENS` | 300 | |
| `MIN_OUT_TOLERANCE_BPS` | 100 | |
| `REPLAY_STARTS_AT`, `REPLAY_SPEED` | the deployment record's | must match the keeper's |
| `RPC_URL`, `BONDLINE_DEPLOYMENT`, `BONDLINE_RAW_DEPLOYMENT`, `BONDLINE_ENV_FILE`, `LOG_DIR` | | as for the keeper |
| `PRICE_HISTORY_ROUNDS` | 60 | feed rounds read for recent prices |
| `MOCK_DECISIONS` | off | `1` on Anvil only |

## Run locally (Anvil)

After the keeper README's local steps (Anvil, deploy, scenario, keeper with `REPLAY_STARTS_AT=<t>`):

```sh
RPC_URL=http://127.0.0.1:8547 BONDLINE_RAW_DEPLOYMENT=$PWD/deployments/raw-31337.json \
CAREFUL_PRIVATE_KEY=<anvil #4> BOLD_PRIVATE_KEY=<anvil #5> REPLAY_SPEED=2000 REPLAY_STARTS_AT=<t> \
MOCK_DECISIONS=1 AGENT_INTERVAL_SECONDS=12 npm start -w @bondline/agents
```

Drop `MOCK_DECISIONS=1` (with `ANTHROPIC_API_KEY` set) for real Claude decisions.

## Build and deploy

`npm run build -w @bondline/agents` → `dist/agents.mjs`. On the droplet: copy it to `/opt/bondline/agents/dist/`, put the
env in `/etc/bondline/agents.env`, install `deploy/bondline-agents.service`. Node 20+.
