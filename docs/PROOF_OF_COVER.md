# ProofOfCover

`ProofOfCover` is a small read-only contract that answers one question for any address: **is this a Bondline covered
account right now, who stands behind it, and how much room does that cover have?** A lending pool, a wallet, a
dashboard or another agent can call it instead of re-implementing Bondline's registry logic.

Source: [contracts/src/ProofOfCover.sol](../contracts/src/ProofOfCover.sol). Tests:
[contracts/test/ProofOfCover.t.sol](../contracts/test/ProofOfCover.t.sol). Robinhood Chain testnet (46630); not
audited. See [SECURITY.md](SECURITY.md).

## The call

```solidity
function isCovered(address account) external view returns (
    bool    covered,      // the account's cover is an offer of the Live or Replay market AND its position is Active
    address underwriter,  // who bonded that cover
    uint256 limitBps,     // the account's loss limit, basis points of principal (1000 = 10%)
    uint256 capBps,       // the cover's cap: it pays down to this drop (3000 = 30%)
    uint256 capacity      // the cover's free bond in USDG units (6 decimals)
);
```

When `covered` is false, every other value is zero.

```solidity
interface IProofOfCover {
    function isCovered(address account)
        external view
        returns (bool covered, address underwriter, uint256 limitBps, uint256 capBps, uint256 capacity);
}

// in a lending pool, for example:
(bool covered,, uint256 limitBps,,) = IProofOfCover(PROOF).isCovered(borrowerAccount);
require(covered && limitBps <= 1000, "account not covered tightly enough");
```

`capacity` is the **cover's** free bond (`bond - reserved`): how much more cover that underwriter could still sell
right now. It is not the amount reserved for this account. To see an account's own reservation, read
`BondlineCover.position(account)`.

## How it decides

1. Call `account.cover()`. If the call fails, returns fewer than 32 bytes, or returns a word that is not a clean
   address, the account is not covered.
2. Ask the Live market, then the Replay market, `isOffer(cover)`. If neither says yes, not covered.
3. Ask the cover for `position(account)`. Covered only if the status is `Active` (not None, Settled or Closed). A fake
   account that names a real cover gets status None there, so it is not covered.
4. Read `underwriter()`, `capBps()` and `free()` from the cover, and `limitBps` from the position.

Every external call is a `staticcall` that copies at most a fixed number of return words, so an EOA, a contract with no
such function, a contract that reverts, and one that returns a huge payload all give `covered = false` instead of a
revert or a memory blow-up (the hostile cases are tests). Gas for a covered account is a handful of `staticcall`s.

Gas is the exception. The account is any contract the caller names, and its `cover()` can burn whatever gas it is
given: in the verifiers' tests a looping account burned about 1.97M of 2M gas, and a transaction with a total gas
limit of about 60,000 or less ran out of gas. Called from another contract with a gas cap, a hostile account can burn
only the cap: the call returns "not covered" or fails. A covered account needs about 41,000 (Live market) to 47,000
(Replay market) gas in such a call, and below that the call fails rather than answering wrongly. So a contract that
calls `isCovered` on an address it doesn't trust should give it a cap with room to spare, such as 100,000 gas, and
treat a failure as "not covered".

## What it is not

- It has **no owner, no setters, no state and no funds**. The two market addresses are `immutable` (`liveMarket`,
  `replayMarket`), set in the constructor. Pointing it at different markets means deploying another one.
- It reports the state at the call. A cover can settle or close in the next block: re-check when it matters.
- "Covered" is a statement about the on-chain book, not about the agent's quality, the underwriter's solvency beyond
  the reserved bond, or whether the prices are real (on testnet, keeper-pushed prices; see
  [SECURITY.md](SECURITY.md)).
- Covers and accounts in the two testnet markets include team-operated test wallets. The registry does not mark
  which; the site and [deployments/rhTestnet.json](../deployments/rhTestnet.json) do.

## Tests

`forge test --match-path test/ProofOfCover.t.sol`: 14 tests, all passing on 4 Oct 2026 (Foundry 1.5.1), including
a 1,000-run fuzz that `isCovered` doesn't revert for random addresses. `forge coverage` on the suite: `ProofOfCover.sol`
100% of lines (41/41), statements (68/68), branches (5/5) and functions (7/7).

| Case | Result |
|---|---|
| Active account on the Replay market / the Live market | covered, with the underwriter, limit, 3000 cap and the cover's free bond |
| A second deposit lowers the cover's free bond | `capacity` follows `cover.free()` |
| After `settle`, after `close` | not covered |
| EOA, address(0), USDG, a market, the checker itself, precompiles 1, 2, 4 | not covered, no revert |
| Cover from a market that is not one of the two | not covered |
| Fake account that names a real cover | not covered |
| Account whose `cover()` reverts, returns 2 bytes, returns dirty high bits, or returns 1 MB | not covered, no revert |
| Fake market/cover with a limit or cap above uint16, a dirty underwriter word, or `isOffer` not exactly 1 | not covered |

## Deployed

Robinhood Chain testnet: [`0x168e27D4A484AA20DEd6bbc0A2272728a9bF4888`](https://explorer.testnet.chain.robinhood.com/address/0x168e27D4A484AA20DEd6bbc0A2272728a9bF4888),
deployed 3 Oct 2026 23:31 UTC in block 128377563
([transaction](https://explorer.testnet.chain.robinhood.com/tx/0x240919b2bd7b2f0ca661fc7f47ca70853fd5a9d1838ad35fa80ae129bd285f8c)),
with the Live market `0x12630304D06837E69BbB27D59dC69ef4ad10Da8D` and the Replay market
`0x734EdAa88537692002Fa89C090D916842e16DE7d` as its two immutables. The explorer shows the source as verified,
partially: the source matches the deployed bytecode, the metadata hash does not match exactly. Record:
[deployments/proof-of-cover.json](../deployments/proof-of-cover.json).

Checked on-chain by an independent verifier on 4 Oct 2026: `isCovered` returned covered for all four covered
accounts on the two markets (team-operated test wallets), with the same underwriter, limit and cap as each cover's
own position, and not covered, without reverting, for 45 other addresses (25 random, 20 special).
