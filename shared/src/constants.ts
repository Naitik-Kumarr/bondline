import type { Address, Hex } from "viem";

/** Paxos USDG on Robinhood Chain testnet ("Global Dollar", 6 decimals). Checked on-chain on 4 Oct 2026. */
export const USDG: Address = "0x7E955252E15c84f5768B83c41a71F9eba181802F";
export const USDG_DECIMALS = 6;

/** Robinhood's official testnet Stock Tokens (18 decimals). Asset order matches each market's asset list. */
export const STOCKS = {
  TSLA: { address: "0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E" as Address, name: "Tesla", decimals: 18 },
  AMZN: { address: "0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02" as Address, name: "Amazon", decimals: 18 },
} as const;
export type StockSymbol = keyof typeof STOCKS;
export const STOCK_SYMBOLS: StockSymbol[] = ["TSLA", "AMZN"];

/** Chainlink feeds on Robinhood Chain mainnet (8 decimals, 24h heartbeat, 0.5% deviation, US equities 24/5). */
export const MAINNET_FEEDS: Record<StockSymbol, Address> = {
  TSLA: "0x4A1166a659A55625345e9515b32adECea5547C38",
  AMZN: "0xD5a1508ceD74c084eBf3cBe853e2C968fB2a651C",
};
export const PRICE_DECIMALS = 8;

/**
 * USDG's EIP-712 domain. The token exposes neither `version()` nor `eip712Domain()`, so it is hardcoded here and
 * tested against the on-chain DOMAIN_SEPARATOR below.
 */
export const USDG_DOMAIN = {
  name: "Global Dollar",
  version: "1",
  chainId: 46630,
  verifyingContract: USDG,
} as const;
export const USDG_DOMAIN_SEPARATOR: Hex = "0xb1debe91e09d82163fd9cddaab89359061c0671664e1611258a3c3de7c2d950b";

/** EIP-3009 ReceiveWithAuthorization: what an underwriter signs once to create and fund an offer. */
export const RECEIVE_WITH_AUTHORIZATION_TYPES = {
  ReceiveWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

/** A settle pays the loss beyond the limit up to a 30% drop. */
export const CAP_BPS = 3000;
export const MAX_FEE_BPS = 500;
export const MIN_DEPOSIT = 1_000_000n; // 1 USDG

/** Mirrors `BlockReason` in contracts/src/Types.sol, in order. */
export const BLOCK_REASONS = [
  { key: "Stopped", label: "Agent stopped by the cover" },
  { key: "Paused", label: "Paused by the user" },
  { key: "ZeroAmount", label: "Zero amount" },
  { key: "AssetNotAllowed", label: "Stock not allowed by the rules" },
  { key: "PriceStale", label: "Price too old" },
  { key: "TradeTooLarge", label: "Trade larger than the per-trade limit" },
  { key: "DailyLimit", label: "Over the daily trading limit" },
  { key: "InsufficientCash", label: "Not enough cash" },
  { key: "InsufficientStock", label: "Not enough stock to sell" },
  { key: "StockShare", label: "Would put too much of the account in stocks" },
  { key: "Slippage", label: "Fill too far from the oracle price" },
  { key: "MinOut", label: "Fill below the agent's minimum" },
  { key: "NoLiquidity", label: "Demo exchange out of inventory" },
] as const;

/** Mirrors `CoverStatus` in contracts/src/Types.sol. */
export const COVER_STATUS = ["None", "Active", "Settled", "Closed"] as const;

/** Labels the site must use. Everything scripted or team-operated is labelled. */
export const LABELS = {
  replayMarket: "Replay market: real prices from 28 Sep to 2 Oct, sped up. Live stock prices are frozen for the weekend.",
  liveMarket: "Live market: Chainlink TSLA and AMZN prices mirrored from Robinhood Chain mainnet by our keeper.",
  demoExchange: "Demo exchange: fills at the oracle price, because testnet Stock Tokens have no market.",
  scriptedGap: "Scripted gap",
  teamUnderwriter: "Team operated test underwriter",
  teamBuyer: "Team operated test buyer",
  keeper: "Our keeper (team operated). Anyone can call settle.",
  notInsurance: "A capped, fully backed protection bond, not regulated insurance.",
  testnet: "Testnet.",
  independent: "Independent project, not affiliated with Robinhood.",
  modelPrice: "A reference price from a simple published model, not actuarial.",
} as const;
