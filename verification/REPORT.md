# Workstreams A–E: final report (4 Oct 2026, 11:45 IST)

Each workstream was built by one agent and re-run by a separate agent that didn't build it. Verdicts, evidence and
every number: `verification/{A,B,C,D,E}.json`. All verdicts were written before 16:00 IST. Testnet only; no
transaction was sent by any verifier.

| | Status | Verified | Blocker or open item |
|---|---|---|---|
| A. Proofs | **pass** | Halmos 0.3.3: 43 of 48 proof instances proven within stated bounds (P2 6/6, P3 6/6, P4 16/16, P5 2/2, P1 13/18); 48/48 reachability witnesses; 5/5 injected bugs caught. 8/8 invariants at 1,000 runs x depth 200 = 200,000 handler calls each. Mutation testing of `BondlineCover.sol`: 977 generated, 747 compile, 720 killed (96.4%), 27 survivors judged equivalent, 0 timeouts. | 5 P1 instances timed out at 900 s (not proven). Each P1–P4 instance fixes the deposit or the limit (fully symbolic attempts timed out). The builder's first-pass split (689/58) is not reproducible and is labelled so. |
| B. Rust pricer | partial | Integer Rust model (no floats) equals the TypeScript model on all 16,071 vectors, and on 31,530 of the verifier's own; 13.8 KB compressed wasm. The exact deployable program (codehash `0x063026be…fdaaec`) run off-chain equals TypeScript on all 10,001 stock shares at the board's inputs (Careful 13.0933 bps, Bold 174.7361 bps); `/agent` shows it labelled off-chain. | Not deployed: Stylus activations are paused. `ArbWasm.activationGas()` returns 2^64 − 1 on Robinhood Chain testnet and mainnet, so `cargo stylus check` cannot pass. No Docker for `cargo stylus verify`. |
| C. SDK and MCP | **pass** | `@bondline/sdk` and `@bondline/mcp`: 22/22 unit, 10/10 end-to-end (local chain), 8/8 MCP over stdio, 4/4 read-only live tests on testnet; the five-line quickstart runs from a clean shell (`docs/agents.md`). | Minor: the signature step doesn't bind the terms (decode before sending); the CLI prints a stack trace on bad flags. |
| D. Evidence and docs | **pass** | Backtest since 23 Jun reproduces from fresh mainnet data: Careful 51 covers, 0 claims; Bold 51 covers, 17 claims, 17.40 USDG paid, loss ratio 0.82% at its 4% fee. ProofOfCover deployed at `0x168e27D4A484AA20DEd6bbc0A2272728a9bF4888`: 14 tests, 100% coverage, right for 4/4 covered accounts and 45/45 others. SECURITY.md, PROOF_OF_COVER.md, claim-letter worker (labels scripted gaps per settle; dry-run never writes under `deployments/`). | No claim letter yet: there is no Settled event until the scripted gap, and letters need a working Claude key. Explorer verification is a partial match (metadata hash). |
| E. Web | partial | `/live`, `/party`, underwriter yield on `/market` (earned-so-far first under 7 days), the "Insured by Bondline" badge (fixed: an RPC failure shows "unavailable", never cached), claim letters on `/account` (re-hash check verified on fixture letters), the Rust price on `/agent` (off-chain), proofs and mutation counts on `/judge`, the copy. Build, tsc, eslint pass; Lighthouse mobile 94 (`/live`) and 97 (`/party`). | The Stylus on-chain call can't run (B). A paid claim on the landing page waits for the scripted gap. |

Contracts, regenerated 4 Oct: 172 Foundry tests pass (168 plus 4 fork tests); line coverage 100% (554/554),
statements 99.72%, branches 98.43%; Slither 0.11.6 on every contract: 0 High, 0 Medium. Deployed runtime bytecode of
all 11 contracts equals a fresh build of `contracts/src`.

## After the report (4 Oct 2026, 15:36 IST)

- The scripted gap claim settled on-chain at **15:36:39 IST** (block 128646129, tx
  `0xbace67dfa4f25b92eca2f0b2806dc5cf6c9d802608aeee6622fff59cc296087c`, settled by our keeper): loss 25.000001 USDG,
  limit 10, bond paid 15.000001 USDG. It followed a replay of the real 28 Sep – 2 Oct prices at 400x (15:12:16 to
  15:30:16 IST) in which the Claude agents traded (Bold 4 trades, Careful 1).
- The hero, `/account` and `/judge` show it on a fresh production build. The main session checked this; no
  independent verifier has re-checked it yet, so E's "paid claim" item is shown but not re-verified.
- D's claim-letter worker wrote the first real letter (`deployments/letters/0xbace…087c.json`), labelled scripted, with
  its hash.
- Still blocked: B's on-chain Stylus pricer (activations paused), and with it E's on-chain Rust call.
