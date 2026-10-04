#!/usr/bin/env bash
# Deploys Bondline to Robinhood Chain testnet and verifies every contract on the explorer (Blockscout).
# Keys come from ./.env and are never printed. Usage: scripts/deploy-testnet.sh
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)

export USDG=0x7E955252E15c84f5768B83c41a71F9eba181802F
export TSLA=0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E
export AMZN=0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02
VERIFIER_URL=https://explorer.testnet.chain.robinhood.com/api/

cd "$ROOT/contracts"
# Keys come from .env through dotenv (scripts/with-env.mjs), never by sourcing .env in a shell.
node "$ROOT/scripts/with-env.mjs" DEPLOYER_PRIVATE_KEY KEEPER_PRIVATE_KEY -- \
  forge script script/Deploy.s.sol \
  --rpc-url rhTestnet --broadcast --slow \
  --verify --verifier blockscout --verifier-url "$VERIFIER_URL"

# The demo exchanges are created inside each market's constructor, so verify them explicitly.
RAW="$ROOT/deployments/raw-46630.json"
j() { node -e "console.log(require('$RAW')['$1'])"; }
for market in live replay; do
  venue=$(j "${market}Venue")
  case $market in live) cap=Live ;; replay) cap=Replay ;; esac
  tslaFeed=$(j "tsla${cap}Feed")
  amznFeed=$(j "amzn${cap}Feed")
  maxAge=$(j "${market}MaxPriceAge")
  args=$(cast abi-encode "constructor(address,address[],address[],uint16,uint32)" \
    "$USDG" "[$TSLA,$AMZN]" "[$tslaFeed,$amznFeed]" "$(j spreadBps)" "$maxAge")
  forge verify-contract "$venue" src/OracleVenue.sol:OracleVenue \
    --chain-id 46630 --verifier blockscout --verifier-url "$VERIFIER_URL" \
    --constructor-args "$args" --watch || echo "venue verification for $market failed; retry later"
done

cd "$ROOT"
node scripts/sync-deployment.mjs 46630
npm run abis
