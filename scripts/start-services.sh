#!/usr/bin/env bash
# Starts the keeper and the agents on this machine against Robinhood Chain testnet, after scripts/go-live.sh.
# Sets the replay start (now + REPLAY_DELAY_SECONDS, default 300) in the deployment record unless it is already set,
# so the keeper and agents (and later the droplet) share one clock. REPLAY_ENDS_BY (unix seconds or an ISO time) sets
# the speed that ends the replay by then; REPLAY_SPEED sets it directly. Both are written to the record with the start.
# Logs go to logs/keeper-testnet.log and logs/agents-testnet.log.
set -euo pipefail
cd "$(dirname "$0")/.."

node -e "
const fs = require('fs');
const p = 'deployments/rhTestnet.json';
const d = JSON.parse(fs.readFileSync(p, 'utf8'));
if (d.fork) { console.error('the record is a fork; run scripts/go-live.sh first'); process.exit(1); }
if (!d.replay.startsAt) {
  const startsAt = Math.floor(Date.now() / 1000) + Number(process.env.REPLAY_DELAY_SECONDS ?? 300);
  const span = d.replay.windowEnd - d.replay.windowStart;
  const endsBy = process.env.REPLAY_ENDS_BY;
  if (endsBy) {
    const t = /^\d+$/.test(endsBy) ? Number(endsBy) : Math.floor(Date.parse(endsBy) / 1000);
    if (!(t >= startsAt + 1800)) { console.error('REPLAY_ENDS_BY must be a time at least 30 minutes after the start'); process.exit(1); }
    d.replay.speed = Math.ceil((span / (t - startsAt)) * 10) / 10; // rounded up, so the replay ends by then
  } else if (process.env.REPLAY_SPEED) {
    d.replay.speed = Number(process.env.REPLAY_SPEED);
    if (!(d.replay.speed > 0)) { console.error('REPLAY_SPEED must be positive'); process.exit(1); }
  }
  d.replay.startsAt = startsAt;
  const json = JSON.stringify(d, null, 2) + '\n';
  fs.writeFileSync(p, json);
  fs.writeFileSync('shared/src/deployment.json', json);
}
const end = d.replay.startsAt + (d.replay.windowEnd - d.replay.windowStart) / d.replay.speed;
console.log('replay starts', new Date(d.replay.startsAt * 1000).toISOString(), 'and ends', new Date(end * 1000).toISOString(), 'at', d.replay.speed + 'x');
"
mkdir -p logs
running() { [ -f "logs/$1.pid" ] && kill -0 "$(cat "logs/$1.pid")" 2>/dev/null; }
if running keeper-testnet; then echo "the testnet keeper already runs here (pid $(cat logs/keeper-testnet.pid))"; else
  nohup npm start -w @bondline/keeper >> logs/keeper-testnet.log 2>&1 &
  echo $! > logs/keeper-testnet.pid
  echo "keeper started"
fi

if node -e "require('dotenv').config({path:'.env', quiet:true}); process.exit(process.env.ANTHROPIC_API_KEY ? 0 : 1)"; then
  if running agents-testnet; then echo "the testnet agents already run here"; else
    nohup npm start -w @bondline/agents >> logs/agents-testnet.log 2>&1 &
    echo $! > logs/agents-testnet.pid
    echo "agents started (Claude Haiku 4.5)"
  fi
else
  echo "ANTHROPIC_API_KEY is not set in .env: the agents are NOT started. Add it, then: npm start -w @bondline/agents"
fi
