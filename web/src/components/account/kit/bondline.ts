// What the wallet flows (/underwrite, /cover, /account) share: the two agents, the two markets, the stocks, and
// the extra errors a USDG transfer can revert with. Plain data, safe on the server and the client.
import { CAP_BPS, LABELS, STOCKS, type StockSymbol } from "@bondline/shared/constants";
import { deployment, type MarketKey } from "@bondline/shared/deployment";
import type { Address } from "viem";

export type PersonaKey = "careful" | "bold";

export interface AgentInfo {
  key: PersonaKey;
  name: string;
  address: Address;
  /** The persona's cap on the share of an account in stocks: an offer's maxStockBps. */
  maxStockBps: number;
  line: string;
}

/** Careful and Bold: the two team-operated AI agents (Claude Haiku 4.5), each with its own wallet. */
export const AGENTS: readonly AgentInfo[] = [
  {
    key: "careful",
    name: "Careful",
    address: deployment.wallets.careful,
    maxStockBps: 3000,
    line: "Each buy must leave at most 30% of the account in stocks; it makes small trades.",
  },
  {
    key: "bold",
    name: "Bold",
    address: deployment.wallets.bold,
    maxStockBps: 8000,
    line: "Each buy must leave at most 80% of the account in stocks; it sizes trades with conviction.",
  },
];

export const agentOf = (address: string | undefined) =>
  address ? AGENTS.find((a) => a.address.toLowerCase() === address.toLowerCase()) : undefined;

export const agentName = (address: string) => agentOf(address)?.name ?? "Agent";

export interface MarketInfo {
  key: MarketKey;
  label: string;
  address: Address;
  /** Oldest price settle, withdraw and the demo exchange accept, in seconds. */
  maxPriceAge: number;
  note: string;
}

const FOUR_HOURS = 4 * 3600;

/** Replay first: live stock prices are frozen for the weekend, so the agents trade on the replay market. */
export const MARKETS: readonly MarketInfo[] = (["replay", "live"] as const).flatMap((key) => {
  const m = deployment.markets[key];
  if (!m.address) return [];
  return [
    {
      key,
      label: m.label,
      address: m.address,
      maxPriceAge: m.maxPriceAge,
      note: key === "replay" ? LABELS.replayMarket : LABELS.liveMarket,
    },
  ];
});

export const marketOf = (address: string | undefined) =>
  address ? MARKETS.find((m) => m.address.toLowerCase() === address.toLowerCase()) : undefined;

export const marketByKey = (key: string | undefined) => MARKETS.find((m) => m.key === key);

/**
 * The rules' default max price age. Live: at most 4 hours, so agents trade only on recent prices and wait out the
 * weekend. Replay: the market's own (its feeds are pushed every few seconds).
 */
export const defaultPriceAge = (market: MarketInfo) =>
  market.key === "live" ? Math.min(market.maxPriceAge, FOUR_HOURS) : market.maxPriceAge;

export const STOCK_BY_ADDRESS: Record<string, { symbol: StockSymbol; name: string; decimals: number }> =
  Object.fromEntries(
    (Object.entries(STOCKS) as [StockSymbol, (typeof STOCKS)[StockSymbol]][]).map(([symbol, s]) => [
      s.address.toLowerCase(),
      { symbol, name: s.name, decimals: s.decimals },
    ]),
  );

export const symbolOf = (address: string) => STOCK_BY_ADDRESS[address.toLowerCase()]?.symbol ?? "stock";

export const CAP_PCT = CAP_BPS / 100;

/** Seconds as "5 min", "4 h", "25 h". */
export function formatAge(seconds: number) {
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return `${Math.round((seconds / 60) * 10) / 10} min`;
  return `${Math.round((seconds / 3600) * 10) / 10} h`;
}

/**
 * Errors a USDG transfer can revert with, so a refusal from inside the token decodes into a name. The OpenZeppelin
 * ERC-20 and SafeERC20 errors are standard; the EIP-3009 and issuer-control names follow the mock our tests use.
 * Decoding only matches an exact selector, so an unknown error is shown raw rather than misnamed.
 */
export const TOKEN_ERRORS = [
  { type: "error", name: "CallerMustBePayee", inputs: [] },
  { type: "error", name: "AuthorizationAlreadyUsed", inputs: [] },
  { type: "error", name: "AuthorizationNotYetValid", inputs: [] },
  { type: "error", name: "AuthorizationExpired", inputs: [] },
  { type: "error", name: "InvalidSignature", inputs: [] },
  { type: "error", name: "ContractPaused", inputs: [] },
  { type: "error", name: "AddressFrozen", inputs: [{ name: "account", type: "address" }] },
  {
    type: "error",
    name: "ERC20InsufficientBalance",
    inputs: [
      { name: "sender", type: "address" },
      { name: "balance", type: "uint256" },
      { name: "needed", type: "uint256" },
    ],
  },
  {
    type: "error",
    name: "ERC20InsufficientAllowance",
    inputs: [
      { name: "spender", type: "address" },
      { name: "allowance", type: "uint256" },
      { name: "needed", type: "uint256" },
    ],
  },
  { type: "error", name: "SafeERC20FailedOperation", inputs: [{ name: "token", type: "address" }] },
] as const;
