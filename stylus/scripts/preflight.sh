#!/bin/sh
# Read-only. Prints ArbWasm.activationGas() on a chain and says whether Stylus activations look paused.
# cargo-stylus treats an activation gas charge above 30,000,000 as "paused" (stylus-tools core/activation.rs).
# Exit 0: open (deploy can proceed). Exit 3: paused (a deploy would fail at the check and send nothing). Exit 2: RPC error.
# Usage: sh stylus/scripts/preflight.sh [rpc-url]    (default: Robinhood Chain testnet)
RPC=${1:-https://rpc.testnet.chain.robinhood.com}
GAS=$(cast call 0x0000000000000000000000000000000000000071 "activationGas()(uint64)" --rpc-url "$RPC" 2>/dev/null | awk '{print $1}')
if [ -z "$GAS" ]; then echo "could not read activationGas() from $RPC" >&2; exit 2; fi
echo "activationGas() = $GAS on $RPC"
if awk -v g="$GAS" 'BEGIN { exit !(g + 0 > 30000000) }'; then
  echo "PAUSED: Stylus activations are closed on this chain; BondlinePricer cannot be activated now."
  exit 3
fi
echo "OPEN: activations are not paused."
