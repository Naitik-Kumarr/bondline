#!/usr/bin/env bash
# The 15:00 IST Gap Party. Run it a few minutes before deployments/party.json's sessionStartsAt (13:00 IST):
# switches the replay to session 2 (the same real 28 Sep - 2 Oct prices, sped up to end exactly at gapAt), restarts the
# keeper (its scripted-gap record goes to deployments/gap-party.json) and the agents, and drops the party's gap control
# file, which the keeper runs the moment session 2 ends. The main replay and its gap claim must be finished first.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f deployments/gap-demo.json ] && grep -q '"settleTx"' deployments/gap-demo.json || { echo "the main gap claim isn't done yet"; exit 1; }
TARGET=$(node -e "const b=require('./deployments/team-book.json').find(x=>x.partyTarget); if(!b){process.exit(1)}; console.log(b.account+' '+b.cover)") \
  || { echo "no party cover yet: npx tsx scripts/testnet-setup.ts party-cover"; exit 1; }
read -r ACCOUNT COVER <<< "$TARGET"

node -e "
const fs = require('fs');
const party = JSON.parse(fs.readFileSync('deployments/party.json', 'utf8'));
const now = Math.floor(Date.now() / 1000);
if (party.gapAt - party.sessionStartsAt < 1800) { console.error('session too short'); process.exit(1); }
for (const p of ['deployments/rhTestnet.json', 'shared/src/deployment.json']) {
  const d = JSON.parse(fs.readFileSync(p, 'utf8'));
  const span = d.replay.windowEnd - d.replay.windowStart;
  if (d.replay.startsAt && d.replay.startsAt + span / d.replay.speed > now) { console.error('the main replay is still running'); process.exit(1); }
  d.replay.sessions = (d.replay.sessions || []).concat(d.replay.startsAt ? [{ startsAt: d.replay.startsAt, speed: d.replay.speed, label: 'session 1' }] : []);
  d.replay.startsAt = party.sessionStartsAt;
  d.replay.speed = span / (party.gapAt - party.sessionStartsAt);
  d.replay.session = 'session 2 (Gap Party)';
  fs.writeFileSync(p, JSON.stringify(d, null, 2) + '\n');
}
party.status = 'live';
fs.writeFileSync('deployments/party.json', JSON.stringify(party, null, 2) + '\n');
console.log('replay session 2 set: speed', (432000 / (party.gapAt - party.sessionStartsAt)).toFixed(1) + 'x');
"

stop() { for p in $(pgrep -f "tsx src/index.ts"); do c=$(lsof -a -p "$p" -d cwd -Fn 2>/dev/null | grep '^n' | cut -c2-); [ "$c" = "/Users/naitik/surety/$1" ] && kill "$p"; done; rm -f "logs/$1-testnet.pid"; }
stop keeper; stop agents; sleep 3

mkdir -p keeper/state
cat > keeper/state/gap.json <<EOF
{ "market": "replay", "cover": "$COVER", "account": "$ACCOUNT", "fridayDrawdownBps": 800, "mondayDrawdownBps": 2500, "weekendSeconds": 360 }
EOF
GAP_OUTPUT="$(pwd)/deployments/gap-party.json" nohup npm start -w @bondline/keeper >> logs/keeper-testnet.log 2>&1 &
echo $! > logs/keeper-testnet.pid
nohup npm start -w @bondline/agents >> logs/agents-testnet.log 2>&1 &
echo $! > logs/agents-testnet.pid
echo "party armed: session 2 runs to the gap; target $ACCOUNT"
