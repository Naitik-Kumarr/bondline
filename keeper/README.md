# Bondline keeper

One process, one wallet (the keeper), one transaction queue: every send is simulated, sent with an explicit nonce and
awaited before the next, so pushes and settles never race.

1. **Live mirror** (every 30 s): reads Chainlink TSLA/USD and AMZN/USD on Robinhood Chain mainnet and pushes any newer
   round into the live MirrorFeeds with its **real value and timestamp**. Unchanged rounds are skipped, so over a
   weekend the live prices stay exactly as stale as mainnet's. A round newer than the testnet's block time waits.
2. **Replay driver** (every 25 s): replay time = `windowStart + (now − startsAt) × speed` (28 Sep 00:00 → 3 Oct 00:00
   UTC; speed 24 = one calendar day per hour, about 5 hours). It pushes the most recent real round at or before that
   time (a step function, no interpolation; before the first in-window round, the last round before the window, kept
   in `data/replay-rounds.json` as `opening`), to both replay feeds, with the latest block's timestamp so they stay
   fresh (the Replay market accepts prices up to 300 s old). Stateless: the position comes from `startsAt` and the
   clock. Before `startsAt` it does nothing; after the window it stops, and replay prices go stale ("market closed").
   A push needs a block newer than the feed's last round; if the chain has gone quiet (local Anvil), the keeper waits a
   second and then sends a zero-value self-transfer to get one.
3. **Settle loop** (every 15 s): every offer in both markets → every account → `health`; if `settleable`, simulate and
   send `settle(account)`. Failures back off per account (30 s doubling to 30 min). Always on.
4. **Scripted gap demo**, only after the replay window has ended, triggered by a control file
   `state/gap.json`:
   ```json
   { "market": "replay", "cover": "0x…", "account": "0x…", "fridayDrawdownBps": 800, "mondayDrawdownBps": 2500, "weekendSeconds": 360 }
   ```
   "Friday close": both replay prices are scaled by one factor `f = ((1 − d)·principal − cash) / stockValue` so the
   account is 8% down (refused if impossible); "weekend": nothing is pushed for `weekendSeconds`, so prices go stale;
   "Monday open": prices are scaled again so the account is about 25% down; the settle loop then settles it. Every
   transaction, the prices, principal, loss, limit and payout go to `../deployments/gap-demo.json` (on chain 46630;
   `gap-demo-<chainId>.json` elsewhere), labelled `"scripted gap"`, and the control file is removed. Progress is saved
   in `state/gap-progress.json`, so a restart resumes. Requires `fridayDrawdownBps < limitBps < mondayDrawdownBps`.
   The agents never trade the replay market outside the replay window, so they never trade at scripted prices.

Logs: JSON lines on stdout and in `logs/keeper.log` (`LOG_DIR` to change).

## Environment

| Variable | Default | |
|---|---|---|
| `KEEPER_PRIVATE_KEY` | required | the keeper wallet; must be the `keeper()` of all four MirrorFeeds |
| `RPC_URL` | Robinhood Chain testnet RPC | required with `BONDLINE_RAW_DEPLOYMENT` |
| `MAINNET_RPC_URL` | `https://rpc.mainnet.chain.robinhood.com` | read-only, for Chainlink prices |
| `BONDLINE_DEPLOYMENT` | `@bondline/shared` record (bundled at build time) | a record JSON read at runtime, e.g. `/opt/bondline/deployments/rhTestnet.json` |
| `BONDLINE_RAW_DEPLOYMENT` | | a `deployments/raw-<chainId>.json` from the Foundry deploy script (local runs) |
| `REPLAY_STARTS_AT` | the record's `replay.startsAt` | unix seconds, ISO date, or `now`; set the same value for the agents |
| `REPLAY_SPEED` | the record's `replay.speed` (24) | |
| `LIVE_MIRROR=0` / `REPLAY=0` | on | turn a loop off (the settle loop can't be turned off) |
| `LIVE_INTERVAL_SECONDS` `REPLAY_INTERVAL_SECONDS` `SETTLE_INTERVAL_SECONDS` | 30 / 25 / 15 | |
| `STATE_DIR` / `GAP_OUTPUT` / `LOG_DIR` | `./state` / `../deployments/gap-demo.json` / `./logs` | |
| `BONDLINE_ENV_FILE` | `./.env`, else `../.env` | a dotenv file to load (never overrides set vars); `none` to skip |

## Run locally (Anvil)

```sh
anvil --port 8547 --silent &
cd contracts && LOCAL=true DEPLOYER_PRIVATE_KEY=<anvil #0> KEEPER_PRIVATE_KEY=<anvil #1> \
  forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8547 --broadcast && cd ..
export RPC_URL=http://127.0.0.1:8547 BONDLINE_RAW_DEPLOYMENT=$PWD/deployments/raw-31337.json
# offers behind Careful and Bold, and a cover on each (see the header of scripts/local-scenario.ts for every option)
UNDERWRITER_PRIVATE_KEY=<anvil #2> BUYER_PRIVATE_KEY=<anvil #3> FUNDER_PRIVATE_KEY=<anvil #0> \
  CAREFUL_PRIVATE_KEY=<anvil #4> BOLD_PRIVATE_KEY=<anvil #5> npm run scenario -w @bondline/keeper
# the keeper, with a fast replay (5 days in about 3.6 minutes)
KEEPER_PRIVATE_KEY=<anvil #1> REPLAY_SPEED=2000 REPLAY_STARTS_AT=now npm start -w @bondline/keeper
# after "replay-ended": copy gapControlExample from keeper/state/scenario-31337-replay.json to keeper/state/gap.json
```

`npm run test:mirror -w @bondline/keeper` checks the live mirror's push path against fresh feeds on Anvil.
`npm run fetch-opening -w @bondline/keeper` re-fetches the opening rounds (read-only).

The scenario script refuses any chain but 31337 unless `CONFIRM_CHAIN_ID=<chainId>` is set; on the testnet, use the
team wallets' keys and amounts sized to the faucet (e.g. `CAREFUL_BOND=50 CAREFUL_DEPOSIT=100 ...`).

## Build and deploy

`npm run build -w @bondline/keeper` → `dist/keeper.mjs` (one file; the replay data and the shared deployment record are
bundled in, so rebuild after the record changes, or set `BONDLINE_DEPLOYMENT`). On the droplet: copy it to
`/opt/bondline/keeper/dist/`, put the env in `/etc/bondline/keeper.env`, install `deploy/bondline-keeper.service`.
Node 20+.
