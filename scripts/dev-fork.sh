#!/usr/bin/env bash
# A local fork of Robinhood Chain testnet (chain 46630, real USDG and Stock Token contracts) for building and testing
# the site and services. Everything happens on the fork; nothing is sent to the real chain.
# Usage: scripts/dev-fork.sh   (then: RH_TESTNET_RPC_URL=http://127.0.0.1:8545 npm run dev)
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)
PORT=${FORK_PORT:-8545}
RPC=http://127.0.0.1:$PORT

if ! cast chain-id --rpc-url "$RPC" >/dev/null 2>&1; then
  nohup anvil --fork-url https://rpc.testnet.chain.robinhood.com --port "$PORT" --block-time 1 --silent \
    > "$ROOT/logs/anvil-fork.log" 2>&1 &
  for _ in $(seq 1 60); do cast chain-id --rpc-url "$RPC" >/dev/null 2>&1 && break; sleep 1; done
fi
[ "$(cast chain-id --rpc-url "$RPC")" = "46630" ] || { echo "fork is not chain 46630"; exit 1; }

USDG=0x7E955252E15c84f5768B83c41a71F9eba181802F
TSLA=0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E
AMZN=0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02
TEN_ETH=0x8AC7230489E80000
addr() { node -e "console.log(require('$ROOT/deployments/wallets.json')['$1'].address)"; }

for role in DEPLOYER KEEPER CAREFUL BOLD UNDERWRITER BUYER; do
  cast rpc anvil_setBalance "$(addr $role)" $TEN_ETH --rpc-url "$RPC" >/dev/null
done

# Borrow tokens from existing testnet holders, on the fork only.
give() {
  cast rpc anvil_impersonateAccount "$2" --rpc-url "$RPC" >/dev/null
  cast rpc anvil_setBalance "$2" $TEN_ETH --rpc-url "$RPC" >/dev/null
  cast send "$1" "transfer(address,uint256)" "$3" "$4" --from "$2" --unlocked --rpc-url "$RPC" >/dev/null
  cast rpc anvil_stopImpersonatingAccount "$2" --rpc-url "$RPC" >/dev/null
}
USDG_HOLDER=0x545FA0D7993929FEf64158F68799E6fAdfbEb983
give $USDG $USDG_HOLDER "$(addr DEPLOYER)" 20000000000      # 20,000 USDG
give $USDG $USDG_HOLDER "$(addr UNDERWRITER)" 20000000000
give $USDG $USDG_HOLDER "$(addr BUYER)" 10000000000          # 10,000 USDG
give $TSLA 0xFfEf1147c3724a19AB7328F4e361C049ba452dA9 "$(addr DEPLOYER)" 100000000000000000000   # 100 TSLA
give $AMZN 0x0A837200fB77687ba9b749E5174bd9a09E51286A "$(addr DEPLOYER)" 100000000000000000000   # 100 AMZN

# Deploy with the real script (same deployer, same nonces, so the same addresses as the real deploy will get).
( export USDG TSLA AMZN
  cd "$ROOT/contracts"
  node "$ROOT/scripts/with-env.mjs" DEPLOYER_PRIVATE_KEY KEEPER_PRIVATE_KEY -- \
    forge script script/Deploy.s.sol --rpc-url "$RPC" --broadcast --slow >/dev/null )
node scripts/sync-deployment.mjs 46630 --fork
mv deployments/raw-46630.json deployments/raw-fork.json
rm -rf contracts/broadcast/Deploy.s.sol/46630

export RH_RPC_URL=$RPC
npx tsx scripts/testnet-setup.ts stock
npx tsx scripts/testnet-setup.ts offers
npx tsx scripts/testnet-setup.ts covers
echo "fork ready at $RPC"
