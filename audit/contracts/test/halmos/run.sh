#!/bin/bash
# Runs the halmos proofs in test/halmos/BondlineHalmos.t.sol, one halmos process per check_* test, in parallel.
#   bash test/halmos/run.sh <outdir> '<regex>'      (from anywhere; it cd's to contracts/)
# Examples:
#   bash test/halmos/run.sh /tmp/hal '^check_(reach_)?p5_'          # property 5 and its reachability witnesses
#   PAR=8 ATO=900s bash test/halmos/run.sh /tmp/hal '^check_p3_'     # property 3, 15 minute solver limit per assertion
# Environment: PAR (parallel processes, default 8), ATO (solver timeout per assertion query, default 900s),
#              SOLVER (default yices). Needs halmos 0.3.3 in ../.venv and forge on PATH.
set -u
cd "$(dirname "$0")/../.."
out=${1:?output directory}; pat=${2:-'^check_'}
mkdir -p "$out"
# shellcheck disable=SC1091
source ../.venv/bin/activate
export FOUNDRY_CONFIG=test/halmos/foundry.halmos.toml FOUNDRY_OUT=out-a FOUNDRY_CACHE_PATH=cache-a
grep -oE "function (check_[A-Za-z0-9_]+)\(" test/halmos/BondlineHalmos.t.sol | sed -E 's/function (.*)\(/\1/' | grep -E "$pat" > "$out/tests.list"
# build once so the parallel halmos processes do not race on the compiler
halmos --root . --contract BondlineHalmosTest --function check_p5_createOffer --forge-build-out out-a --no-status > /dev/null 2>&1
export OUT="$out" SOLVER="${SOLVER:-yices}" ATO="${ATO:-900s}"
xargs -P "${PAR:-8}" -n1 bash -c '
  t=$0
  ( time halmos --root . --contract BondlineHalmosTest --function "$t" --forge-build-out out-a \
      --solver "$SOLVER" --solver-timeout-branching 2s --solver-timeout-assertion "$ATO" --no-status ) \
      > "$OUT/$t.log" 2>&1
' < "$out/tests.list"
