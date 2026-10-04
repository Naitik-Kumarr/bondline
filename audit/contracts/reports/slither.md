# Slither 0.11.6 on contracts/src, 4 Oct 2026

Command, from `contracts/`: `../.venv/bin/slither . --config-file slither.config.json` (Slither 0.11.6 from the
project's `.venv`; the config filters `lib/`, `test/` and `script/`, and compiles `src/` with Foundry). It covers
every contract in `src/`, including `ProofOfCover.sol`.

| Impact | Detector | Count |
|---|---|---|
| Low | calls-loop | 4 |
| Low | missing-zero-check | 8 |
| Low | reentrancy-benign | 2 |
| Low | reentrancy-events | 1 |
| Low | timestamp | 6 |
| Informational | assembly | 3 |
| Informational | low-level-calls | 1 |
| Informational | naming-convention | 1 |

High: 0. Medium: 0.

## Each finding

- **calls-loop (4):** `AgentAccount._valuation` reads `balanceOf` for each listed stock and `_read` calls each
  stock's price feed in a loop. The lists are fixed when the account is created (two stocks on testnet) and come
  from the market, not from the user.
- **missing-zero-check (8):** `AgentAccount.initialize` (owner, agent, market, USDG, venue), the `OracleVenue`
  constructor (USDG) and the `ProofOfCover` constructor (both market addresses). Accounts are initialized only by a
  market-created cover's `open`, with the market's own addresses; each venue is created inside `BondlineMarket`'s
  constructor, which already rejects a zero USDG address; ProofOfCover is deployed once by its deploy step.
- **reentrancy-benign (2):** `BondlineMarket.createOfferWithAuthorization` and `BondlineCover.open` write state
  after calling USDG or the new clone. USDG is the fixed Paxos token, the clone is market-created, and both entry
  points are `nonReentrant`.
- **reentrancy-events (1):** `BondlineMarket.delist` emits its event after calling the cover; the cover is
  market-created.
- **timestamp (6):** price age (`PriceMath.age`), feed pushes (`MirrorFeed.push`) and the account's daily volume and
  price-freshness checks compare `block.timestamp`. These are intended rules on hour-scale windows.
- **assembly (3):** `ProofOfCover._readMany` makes its `staticcall` in assembly and copies at most a fixed number
  of return words, so an untrusted account can't make the read revert on bad return data or blow up memory;
  `_read` and `_terms` use assembly only to load a word from the returned buffer.
- **low-level-calls (1):** `OracleVenue._checkAccount` reads the caller's `cover()` with a raw `staticcall`, so an
  address without code or with the wrong return shape gets a clean `NotBondlineAccount` revert.
- **naming-convention (1):** `IUSDG.DOMAIN_SEPARATOR()` is USDG's own function name.
