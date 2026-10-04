# BondlinePricer (Stylus)

Bondline's reference price ([docs/PRICING.md](../docs/PRICING.md), [shared/src/pricing.ts](../shared/src/pricing.ts))
as a Rust contract for Arbitrum Stylus, in integer fixed-point math only. No floats anywhere, including N(x) and sqrt.
It is a published, callable copy of the model. The Solidity markets do not call it, and it has no storage.

## Status (read this first)

**Built, tested offline, not deployed, and not deployable today.**

- Tested: the Rust model, the compiled WASM and the exact bytes `cargo stylus` would deploy all reproduce every one of
  the 16,071 vectors in `vectors.json` (80,355 integers) exactly. See "Build, test".
- Blocked: Stylus activation is closed on Robinhood Chain. `ArbWasm.activationGas()` (the gas `activateProgram`
  charges) returns 2^64 - 1 = 18446744073709551615, which no transaction can pay, so no new Stylus program can be
  activated, and `cargo stylus check` / `deploy` stop with "Stylus activations appear to be paused on this chain".
  Measured with `cast call` on 2026-10-03 at about 23:40 UTC (04 Oct, about 05:10 IST), and read again on Robinhood
  testnet at 2026-10-04 00:02 UTC (05:32 IST), same value:

  | Chain | Chain id | `activationGas()` |
  |---|---|---|
  | Robinhood Chain testnet | 46630 | 18446744073709551615 |
  | Robinhood Chain mainnet | 4663 | 18446744073709551615 |
  | Arbitrum One | 42161 | 18446744073709551615 |
  | Arbitrum Nova | 42170 | 18446744073709551615 |
  | Arbitrum Sepolia | 421614 | 18446744073709551615 |

  All five run the same node build (`nitro/v3.12.1-rc.2+70fa99a-20260929T140226Z`) and report `stylusVersion()` = 3.
  A read-only `activateProgram` call (state override, no transaction) reverts with empty data on Robinhood testnet and
  on Arbitrum Sepolia, both for this program and for an address with no code, so the revert is not about this program.
- Why: Arbitrum's documentation notice says its Security Council paused new Stylus activations on Arbitrum One and Nova
  and that no date for resuming is given
  ([docs.arbitrum.io/notices/stylus-activation-pause-notice](https://docs.arbitrum.io/notices/stylus-activation-pause-notice)).
  That notice does not mention Orbit chains such as Robinhood Chain. What was measured here is the value, not who set it
  on Robinhood Chain or when it will be lifted.
- Check before any deploy: `sh stylus/scripts/preflight.sh` (read-only; exit 0 = open, 3 = paused).
- Meanwhile, `evm/` holds an EVM twin with the same ABI and the same integers (see "EVM twin").

## Interface

```solidity
function quote(uint256 wBps, uint256 sigmaBps, uint256 termDays, uint256 limitBps, uint256 capBps)
    external pure
    returns (uint256 pHitBps, uint256 gapBps, uint256 riskBps, uint256 reserveBps, uint256 fairBps);
```

Selector `0xcf408eb1`. ABI: `abi.json` (named outputs); `abi.sol` is what `cargo stylus export-abi` prints.

| Input | Meaning | Allowed |
|---|---|---|
| `wBps` | share of the account in stocks | 0 to 10000 |
| `sigmaBps` | annual volatility of the most volatile allowed stock (5457 = 54.57%) | 0 to 1,000,000 |
| `termDays` | the cover's term | 1 to 36,500 |
| `limitBps` | loss limit L | 1 to `capBps` - 1 |
| `capBps` | cap | 1 to 10000 |

Outside these bounds it reverts with `WBpsTooLarge`, `SigmaBpsTooLarge`, `TermDaysOutOfRange`, `CapBpsOutOfRange` or
`LimitBpsOutOfRange`, checked in that order. The model's domain is the same except sigma and the term are also bounded
here so the 256-bit arithmetic cannot overflow, and the term is whole days.

The model: `P = min(1, 2 N(-L / (σa √T)))`, `gap = min(band, 0.5826 σa √g)`, `risk = 2 P gap`,
`reserve = band × 5% × T`, `fair = risk + reserve`, with `σa = w σ`, `T = termDays/365`, `g = 1.5/252`,
`band = cap - L`.

## Units and rounding

- Every output is **basis points scaled by 1e4**, i.e. the fraction times 1e8. `1` means 0.0001 bps;
  `100_000_000` means 100%; `130_933` means 13.0933 bps.
- Each output is **rounded half up, once**, from the exact value held at 1e30 precision. `fair` is the rounding of the
  exact `risk + reserve`, so it can differ from `riskBps + reserveBps` by 1 unit.
- The TypeScript side (`scripts/vectors.ts`, `modelRow`) does `Math.round(bps × 1e4)` on the unrounded
  double-precision model value: same units, same half-up rule, same "round the exact fair" rule.

## How N(x), sqrt and exp work without floats

- Intermediates are 256-bit integers (`alloy_primitives::U256`) scaled by 1e30.
- N(x) is Hart's rational approximation exactly as `normalCdf` in the TypeScript model. The coefficients are generated
  from that file's decimal literals by `scripts/gen-consts.mjs` into `src/consts.rs` (and `evm/src/PricerConsts.sol`), so
  they match digit for digit. N(-z) is 0 above z = 37, like the TypeScript model.
- `exp(-x)`: range reduction by ln 2 (a 30-digit constant) and a Taylor series of 45 terms.
- sqrt: integer Newton iteration.

## Build, test

Needs Rust 1.88.0 (`rust-toolchain.toml` pins it and the wasm32 target) and `cargo-stylus` 0.10.10. The SDK is
`stylus-sdk` 0.10.10: the latest published when checked (`cargo search`) and the same version number as cargo-stylus
0.10.10. `Cargo.lock` pins ruint 1.17.2 (newer ruint needs a newer rustc). The compiled program imports only six host
functions: `vm_hooks.read_args`, `write_result`, `storage_flush_cache`, `pay_for_memory_grow`, `msg_reentrant` and
`msg_value`. Whether the chain's Stylus version 3 activates it could not be checked, because activation is closed (see
Status).

```bash
cd stylus
cargo test --lib --release          # unit tests + every vector (use --lib: the cdylib can't link natively)
cargo build --release --target wasm32-unknown-unknown
node scripts/wasm-check.mjs         # runs the built WASM in Node with stubbed host calls against every vector
cargo stylus get-initcode --output /tmp/initcode.hex
node scripts/wasm-check.mjs --initcode /tmp/initcode.hex   # same, on the exact bytes cargo-stylus deploys; prints the codehash
cargo stylus export-abi > abi.sol   # then, from the repo root: npx tsx stylus/scripts/abi.mjs  (writes abi.json)
cargo stylus check --endpoint https://rpc.testnet.chain.robinhood.com   # stops at activation while paused
```

Regenerate the vectors and constants (from the repo root) after any change to `shared/src/pricing.ts`:

```bash
node stylus/scripts/gen-consts.mjs
npx tsx stylus/scripts/vectors.ts
```

`vectors.json` holds 16,071 rows: the ten `PRICING_VECTORS`, a grid, 2,500 seeded pseudo-random rows over the whole
domain, and edge cases (far tail, one-bps limits, sigma 1,000,000, 36,500-day term). Each row is the TypeScript model's
answer rounded to the contract's units. `evm/test/vectors.flat.json` is the same rows flattened for the Solidity test.

## Deploy

Needs the chain to have activations open (`sh stylus/scripts/preflight.sh` exits 0). Run from this folder. The key is
loaded by the dotenv-based wrapper, which passes only `DEPLOYER_PRIVATE_KEY` to the command and prints nothing. Never
`source` the `.env` file in a shell: a line with a space makes bash print part of it in an error.

```bash
cd /Users/naitik/surety/stylus
node /Users/naitik/surety/scripts/with-env.mjs DEPLOYER_PRIVATE_KEY -- sh -c 'cargo stylus deploy --no-verify --endpoint https://rpc.testnet.chain.robinhood.com --private-key "$DEPLOYER_PRIVATE_KEY"'
```

- `--no-verify` is needed because the default reproducible build runs in Docker, which is not installed on this
  machine (`docker: command not found`; no podman, colima, orbstack, nerdctl or lima either).
- `deploy` runs the activation check before it builds any transaction (`stylus-tools` `core/deployment/mod.rs`,
  `deploy` calls `check_contract` first). While activations are paused it exits 1 with the "paused" message and sends
  nothing. This was run with a throwaway zero-balance key, not the deployer's.
- It goes through the StylusDeployer contract (`0xcEcba2F1DC234f70Dd89F2041029807F8D03A990`, code present on testnet),
  which, per `cargo stylus deploy --help`, deploys, activates and initializes the constructor.
- Do not edit any `.rs` file, `Cargo.toml`, `Cargo.lock` or `rust-toolchain.toml` between building and deploying: the
  deployment embeds a hash of them (`207062f8076cee9de1ae42387947fe1d48c120c3a257a642b4235f8395242ab8` for this tree).

**Cost.** `cargo stylus deploy --estimate-gas` cannot report a figure while activation is paused: it fails at the same
check. What was measured on Robinhood testnet (read-only): the program is 13,819 bytes compressed (`cargo stylus check`),
45,619 bytes of wasm; `cast estimate --create` on the 13,862-byte initcode, which stores the code without activating it,
gives 3,603,726 gas; `cast gas-price` gives 10,000,000 wei, so that is about 0.000036 ETH. The activation data fee and
activation gas are not included and could not be measured.

## Verify

What each option needs, and what is possible here:

1. **Behaviour, any time after a deploy: `verify-onchain.ts`.** Read-only `eth_call`s of `quote` against rows of
   `vectors.json`, plus a revert check and an optional code-hash check:

   ```bash
   npx tsx stylus/scripts/verify-onchain.ts <address> --n 400 --expect-codehash 0x063026be3176d38d9a5f1dca4d2c9e829918371b4430f6abb98bb1a5b3fdaaec
   ```

   The code hash is keccak256 of the 13,819 program bytes of this exact build (printed by
   `wasm-check.mjs --initcode`). It matches only if the deployed program is byte-identical to this build; two clean rebuilds on this machine gave the
   same initcode (same sha256), and a change to any source file changes it, so re-derive it after any edit. The script is
   tested offline against the real program bytes (`--local-initcode FILE`: 16,071 of 16,071 vectors) and against the
   RPC path (an address with no code fails cleanly). It has not run against a deployed Stylus contract, because none
   exists.
2. **`cargo stylus verify`.** The default needs Docker (not installed here) and a deployment made without
   `--no-verify`. With `--no-verify` it rebuilds locally, which only checks the build against itself on this machine.
3. **Blockscout.** The testnet explorer (backend v10.2.6) answers `POST /api/v2/smart-contracts/<address>/verification/via/stylus-github-repository`
   with 400 for an empty body, like its known `flattened-code` route, and 404 for an unknown route name; but the
   instance's `verification_options` list does not include it (it lists multi-part, flattened-code, standard-input and
   the Vyper methods). So it is not confirmed that Stylus verification works there. Blockscout's documentation says the
   method takes a public GitHub repository, a commit, the cargo-stylus version and a path prefix, and that its service
   rebuilds with `cargo stylus verify --no-verify`
   ([docs.blockscout.com/devs/verification/stylus-verification](https://docs.blockscout.com/devs/verification/stylus-verification)).
   A rebuild can only match if the on-chain bytes are reproducible, and a build on this Mac is not: the wasm embeds
   absolute host paths such as `/Users/naitik/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/ruint-1.17.2/src/...`
   (`strings` on the built wasm). The way to a verifiable build is the Docker deployment, on a machine with Docker.

## EVM twin (`evm/`)

`evm/src/BondlinePricerEvm.sol` is the same model in Solidity 0.8.28: the same integer steps, the same ABI (`abi.json`
is identical to its ABI for functions and errors, same selector `0xcf408eb1`), the same outputs. It deploys on
Robinhood Chain today because it needs no activation. It is a separate contract, not the Stylus program, and should be
labelled as such.

```bash
cd stylus/evm
forge test -vv                      # 8 tests, including all 16,071 vectors exactly (80,355 integers)
```

Measured in Forge's test EVM (not on chain): one `quote` costs 36,187 to 40,787 gas with the call included. The runtime
is 3,562 bytes (`forge build --sizes`).

Deploy and verify (not run; the key is loaded by the wrapper, as above):

```bash
cd /Users/naitik/surety/stylus/evm
node /Users/naitik/surety/scripts/with-env.mjs DEPLOYER_PRIVATE_KEY -- sh -c 'forge create src/BondlinePricerEvm.sol:BondlinePricerEvm --rpc-url https://rpc.testnet.chain.robinhood.com --private-key "$DEPLOYER_PRIVATE_KEY" --broadcast --verify --verifier blockscout --verifier-url https://explorer.testnet.chain.robinhood.com/api/'
npx tsx ../scripts/verify-onchain.ts <address> --n 400
```

## Files

| Path | What |
|---|---|
| `src/math.rs` | the model, integers only |
| `src/lib.rs`, `src/main.rs` | the Stylus entrypoint and ABI, and the ABI-export main |
| `src/consts.rs` | generated: Hart coefficients from `shared/src/pricing.ts` |
| `src/tests.rs` | unit tests and the vector test (`cargo test --lib`) |
| `vectors.json` | 16,071 TypeScript-model rows in the contract's integer units (generated) |
| `abi.json`, `abi.sol` | JSON ABI with named outputs; the interface `cargo stylus export-abi` prints |
| `scripts/vectors.ts`, `scripts/gen-consts.mjs`, `scripts/abi.mjs` | generators |
| `scripts/wasm-check.mjs`, `scripts/lib/program.mjs` | run the built program in Node against every vector |
| `scripts/verify-onchain.ts` | read-only checker for a deployed pricer (Stylus or EVM twin) |
| `scripts/preflight.sh` | read-only: are Stylus activations open on a chain |
| `evm/` | the EVM twin, its constants, its Foundry config and test |
