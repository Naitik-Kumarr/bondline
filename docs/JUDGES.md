# Bondline for judges: the 3-minute path

Testnet and unaudited. A capped, fully backed protection bond, not regulated insurance. Independent project, not affiliated with Robinhood. The replay market, the scripted gap and the team wallets are labelled everywhere.

## 1. Take the tour (2 minutes, no wallet)

Open **/tour** on the live site: six screens, each with its on-chain link.

## 2. See the claim that paid

[Settle transaction](https://explorer.testnet.chain.robinhood.com/tx/0xbace67dfa4f25b92eca2f0b2806dc5cf6c9d802608aeee6622fff59cc296087c) on the Replay market (scripted gap, team-operated test cover behind the Bold agent):

- **The gap:** the account fell from 92 to 75 USDG (25% down) against a 10% loss limit.
- **The payout:** the user's loss was fixed at their 10%, and the underwriter's bond paid **15.000001 USDG**.
- **The stop:** the agent stopped in the same transaction.
- **Who settled:** our keeper called `settle`, which anyone can call.

## 3. See one-signature underwriting

[Careful's offer](https://explorer.testnet.chain.robinhood.com/tx/0x31ebad7ca3afe5754fee3856f692afb23125390d074d3463748c89a7b5102db6) and [Bold's offer](https://explorer.testnet.chain.robinhood.com/tx/0xb0b099a4f9e8b272a0677d2988c46b893625b6be81e0a0610aa914c69dd182f5): `createOfferWithAuthorization` pulls the USDG bond with Paxos USDG's `receiveWithAuthorization` (EIP-3009), then creates and funds the offer in one transaction.

## 4. Check every claim

Open **/judge** on the live site. It covers each criterion with its proof, the worked example, every on-chain moment with its transaction, and what nobody can do.

## 5. Read the security picture

- `docs/SECURITY.md`: trust assumptions, what each contract can and cannot do, known limits, and section 6, the independent review of 4 Oct 2026.
- `audit/AUDIT.md`: the full independent review. 0 critical findings, and 1 high: a payout can be delayed by unsolicited stock dust while that stock's feed is stale; the fix is planned before any mainnet beta. Every finding has a failing proof test in `audit/contracts/test/AuditMoneySafety.t.sol`.
- **Tests:** 172 Foundry tests; run them with `cd contracts && forge test`.

## Contracts (Robinhood Chain testnet, chain 46630)

| Contract | Address |
|---|---|
| BondlineMarket (Live) | [`0x12630304D06837E69BbB27D59dC69ef4ad10Da8D`](https://explorer.testnet.chain.robinhood.com/address/0x12630304D06837E69BbB27D59dC69ef4ad10Da8D) |
| BondlineMarket (Replay) | [`0x734EdAa88537692002Fa89C090D916842e16DE7d`](https://explorer.testnet.chain.robinhood.com/address/0x734EdAa88537692002Fa89C090D916842e16DE7d) |
| BondlineCover (implementation) | [`0x341Eb4096EB6e4ab8Ce0cD409ff0310dE1f92F1f`](https://explorer.testnet.chain.robinhood.com/address/0x341Eb4096EB6e4ab8Ce0cD409ff0310dE1f92F1f) |
| AgentAccount (implementation) | [`0xF4429Aa682e93548c88069276f7dA235416836Ff`](https://explorer.testnet.chain.robinhood.com/address/0xF4429Aa682e93548c88069276f7dA235416836Ff) |
| OracleVenue (Live, demo exchange) | [`0x338499703bde8EbA6308750745D53495B362f7d5`](https://explorer.testnet.chain.robinhood.com/address/0x338499703bde8EbA6308750745D53495B362f7d5) |
| OracleVenue (Replay, demo exchange) | [`0xEEc9A484D8b830BEdD7C85B2db377455AcA797A2`](https://explorer.testnet.chain.robinhood.com/address/0xEEc9A484D8b830BEdD7C85B2db377455AcA797A2) |
| MirrorFeed TSLA (Live) | [`0xF18710dA444EFEB3f9E2Fa3e90c61d609906972D`](https://explorer.testnet.chain.robinhood.com/address/0xF18710dA444EFEB3f9E2Fa3e90c61d609906972D) |
| MirrorFeed AMZN (Live) | [`0x404e911Bafc0293A30B77fAd33f1521C466fC524`](https://explorer.testnet.chain.robinhood.com/address/0x404e911Bafc0293A30B77fAd33f1521C466fC524) |
| MirrorFeed TSLA (Replay) | [`0x9e5D027cd67C800a48FBf1Fb0764Fd2c60672279`](https://explorer.testnet.chain.robinhood.com/address/0x9e5D027cd67C800a48FBf1Fb0764Fd2c60672279) |
| MirrorFeed AMZN (Replay) | [`0x8b592B586A20638A418F77e1Cb62e224920eB7eC`](https://explorer.testnet.chain.robinhood.com/address/0x8b592B586A20638A418F77e1Cb62e224920eB7eC) |
| ProofOfCover | [`0x168e27D4A484AA20DEd6bbc0A2272728a9bF4888`](https://explorer.testnet.chain.robinhood.com/address/0x168e27D4A484AA20DEd6bbc0A2272728a9bF4888) |
| Paxos USDG (testnet, external) | [`0x7E955252E15c84f5768B83c41a71F9eba181802F`](https://explorer.testnet.chain.robinhood.com/address/0x7E955252E15c84f5768B83c41a71F9eba181802F) |
