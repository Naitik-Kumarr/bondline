#!/usr/bin/env bash
# After the main replay ends: the scripted gap claim on the gap-demo account, the hero's real numbers, records rebuilt
# from the real chain, the two tight-limit live covers and the party's target cover. Uses the team buyer and Bold's
# spare USDG, never the deployer. Safe to re-run: each step skips what's already done.
set -euo pipefail
cd "$(dirname "$0")/.."

GAP_ACCOUNT=$(node -e "const b=require('./deployments/team-book.json').find(x=>x.gapDemo); if(!b){process.exit(1)}; console.log(b.account+' '+b.cover)")
read -r ACCOUNT COVER <<< "$GAP_ACCOUNT"

if [ ! -f deployments/gap-demo.json ]; then
  mkdir -p keeper/state
  if [ ! -f keeper/state/gap.json ]; then
    cat > keeper/state/gap.json <<EOF
{ "market": "replay", "cover": "$COVER", "account": "$ACCOUNT", "fridayDrawdownBps": 800, "mondayDrawdownBps": 2500, "weekendSeconds": 360 }
EOF
    echo "gap control written for $ACCOUNT (runs as soon as the replay window has ended)"
  fi
  for _ in $(seq 1 120); do
    [ -f deployments/gap-demo.json ] && grep -q '"settleTx"' deployments/gap-demo.json && break
    sleep 15
  done
fi
grep -q '"settleTx"' deployments/gap-demo.json || { echo "no settled gap claim yet; re-run later"; exit 1; }

node scripts/sync-gap-demo.mjs
npm run record careful bold
npx tsx scripts/testnet-setup.ts live-covers
npx tsx scripts/testnet-setup.ts party-cover
echo "after-replay done"
