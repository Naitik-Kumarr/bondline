#!/usr/bin/env bash
# S2 in one go, on Robinhood Chain testnet: deploy and verify, then the team-operated test book sized to what the
# wallets hold, then the inventory check. Stops at the first failure. Keys stay in ./.env and are never printed.
# Usage: scripts/go-live.sh            (then start the keeper and agents; see scripts/start-services.sh)
set -euo pipefail
cd "$(dirname "$0")/.."

[ "$(node -e "console.log(require('./deployments/rhTestnet.json').fork ? 'fork' : 'real')")" = "fork" ] || \
  [ "$(node -e "console.log(require('./deployments/rhTestnet.json').status)")" != "deployed" ] || \
  { echo "deployments/rhTestnet.json already holds a real deployment; not redeploying"; exit 1; }

echo "== deploy and verify"
scripts/deploy-testnet.sh

setup() { echo "== $1"; npx tsx scripts/testnet-setup.ts "$1"; }
setup plan
setup gas
setup consolidate
setup stock
setup offers
setup covers
setup inventory
setup balances
echo "S2 done. Team book: deployments/team-book.json. Log: deployments/setup-log.json."
