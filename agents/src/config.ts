// Kept identical to keeper/src/config.ts so each service bundles on its own.
// Configuration shared by the keeper's entry point and scripts: env loading, the deployment record, RPC clients,
// and the markets as read from the chain. Secrets are loaded with dotenv and never printed.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config as dotenv } from "dotenv";
import {
  createPublicClient,
  defineChain,
  erc20Abi,
  getAddress,
  http,
  isAddress,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type Transport,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import {
  bondlineMarketAbi,
  deployment as sharedRecord,
  robinhoodMainnet,
  robinhoodTestnet,
  STOCK_SYMBOLS,
  type Deployment,
  type MarketKey,
  type StockSymbol,
} from "@bondline/shared";

export const MARKET_KEYS: MarketKey[] = ["live", "replay"];

/** Loads env vars from a .env file without overriding anything already set (explicit env always wins). */
export function loadEnvFile(): string | null {
  const explicit = process.env.BONDLINE_ENV_FILE;
  if (explicit === "none") return null;
  const candidates = explicit ? [resolve(explicit)] : [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../.env")];
  for (const path of candidates) {
    if (existsSync(path)) {
      dotenv({ path, quiet: true, override: false });
      return path;
    }
  }
  return null;
}

export interface ReplaySchedule {
  windowStart: number;
  windowEnd: number;
  speed: number;
  startsAt: number | null;
}

export interface NetConfig {
  /** Where the addresses came from. */
  source: string;
  expectedChainId: number;
  rpcUrl: string;
  usdg: Address;
  stocks: Record<StockSymbol, Address>;
  markets: Record<MarketKey, Address>;
  replay: ReplaySchedule;
}

function addr(value: unknown, what: string): Address {
  if (typeof value !== "string" || !isAddress(value)) throw new Error(`deployment: ${what} is missing or not an address`);
  return getAddress(value);
}

function parseTime(value: string, what: string): number {
  if (value === "now") return Math.floor(Date.now() / 1000);
  if (/^\d+$/.test(value)) return Number(value);
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw new Error(`${what} must be unix seconds, an ISO date or "now"`);
  return Math.floor(ms / 1000);
}

/**
 * The network to run against: the shared testnet record by default; BONDLINE_DEPLOYMENT=<record.json> for a
 * record file read at runtime; BONDLINE_RAW_DEPLOYMENT=<raw-31337.json> for a local Anvil deployment.
 */
export function loadNetConfig(): NetConfig {
  const rawPath = process.env.BONDLINE_RAW_DEPLOYMENT;
  const recordPath = process.env.BONDLINE_DEPLOYMENT;
  let cfg: NetConfig;

  if (rawPath) {
    const raw = JSON.parse(readFileSync(resolve(rawPath), "utf8")) as Record<string, unknown>;
    const rpcUrl = process.env.RPC_URL;
    if (!rpcUrl) throw new Error("RPC_URL is required with BONDLINE_RAW_DEPLOYMENT");
    cfg = {
      source: resolve(rawPath),
      expectedChainId: Number(raw.chainId),
      rpcUrl,
      usdg: addr(raw.usdg, "usdg"),
      stocks: { TSLA: addr(raw.tsla, "tsla"), AMZN: addr(raw.amzn, "amzn") },
      markets: { live: addr(raw.liveMarket, "liveMarket"), replay: addr(raw.replayMarket, "replayMarket") },
      replay: { ...sharedRecord.replay, startsAt: null },
    };
  } else {
    const record: Deployment = recordPath
      ? (JSON.parse(readFileSync(resolve(recordPath), "utf8")) as Deployment)
      : sharedRecord;
    if (record.status !== "deployed" || !record.markets.live.address || !record.markets.replay.address) {
      throw new Error(
        `the testnet deployment record (${recordPath ?? "@bondline/shared"}) says "${record.status}"; ` +
          "set BONDLINE_DEPLOYMENT or BONDLINE_RAW_DEPLOYMENT",
      );
    }
    cfg = {
      source: recordPath ? resolve(recordPath) : "@bondline/shared deployment.json",
      expectedChainId: record.chainId,
      rpcUrl: process.env.RPC_URL ?? robinhoodTestnet.rpcUrls.default.http[0],
      usdg: addr(record.usdg, "usdg"),
      stocks: { TSLA: addr(record.assets.TSLA, "assets.TSLA"), AMZN: addr(record.assets.AMZN, "assets.AMZN") },
      markets: {
        live: addr(record.markets.live.address, "markets.live.address"),
        replay: addr(record.markets.replay.address, "markets.replay.address"),
      },
      replay: { ...record.replay },
    };
  }

  const env = process.env;
  if (env.REPLAY_SPEED) cfg.replay.speed = Number(env.REPLAY_SPEED);
  if (env.REPLAY_WINDOW_START) cfg.replay.windowStart = parseTime(env.REPLAY_WINDOW_START, "REPLAY_WINDOW_START");
  if (env.REPLAY_WINDOW_END) cfg.replay.windowEnd = parseTime(env.REPLAY_WINDOW_END, "REPLAY_WINDOW_END");
  if (env.REPLAY_STARTS_AT) cfg.replay.startsAt = parseTime(env.REPLAY_STARTS_AT, "REPLAY_STARTS_AT");
  if (!(cfg.replay.speed > 0)) throw new Error("replay speed must be positive");
  if (!(cfg.replay.windowEnd > cfg.replay.windowStart)) throw new Error("replay window end must be after its start");
  return cfg;
}

/** Replay time for a wall-clock time, or null before the replay starts or when no start is configured. */
export function replayTimeAt(s: ReplaySchedule, now: number): number | null {
  if (s.startsAt === null || now < s.startsAt) return null;
  return s.windowStart + (now - s.startsAt) * s.speed;
}

/** Wall-clock time at which the replay window ends, or null if no start is configured. */
export function replayEndsAt(s: ReplaySchedule): number | null {
  if (s.startsAt === null) return null;
  return s.startsAt + Math.ceil((s.windowEnd - s.windowStart) / s.speed);
}

// ---------------------------------------------------------------- RPC

export function transport(url: string, service: string): Transport {
  // Robinhood Chain's public RPCs reject some default user agents (403) and rate-limit (429): send our own user
  // agent, keep requests unbatched, and let viem back off (it retries 403/408/429/5xx with exponential delay).
  return http(url, {
    batch: false,
    retryCount: 5,
    retryDelay: 500,
    timeout: 20_000,
    fetchOptions: { headers: { "user-agent": `bondline-${service}/0.1` } },
  });
}

export function chainFor(id: number, rpcUrl: string): Chain {
  if (id === robinhoodTestnet.id) return robinhoodTestnet;
  if (id === robinhoodMainnet.id) return robinhoodMainnet;
  return defineChain({
    id,
    name: id === 31337 ? "Anvil (local)" : `Chain ${id}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
}

/** A public client for the configured chain, after checking the RPC really serves that chain. */
export async function connect(cfg: NetConfig, service: string): Promise<{ client: PublicClient; chain: Chain }> {
  const t = transport(cfg.rpcUrl, service);
  const probe = createPublicClient({ transport: t });
  const id = await probe.getChainId();
  if (id !== cfg.expectedChainId) {
    throw new Error(`RPC serves chain ${id} but the deployment (${cfg.source}) is for chain ${cfg.expectedChainId}`);
  }
  const chain = chainFor(id, cfg.rpcUrl);
  return { client: createPublicClient({ chain, transport: t }) as PublicClient, chain };
}

export function rpcHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "invalid-url";
  }
}

/** Loads a private key from the environment. Only the derived address is ever printed. */
export function accountFromEnv(name: string): PrivateKeyAccount {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set`);
  const key = (value.startsWith("0x") ? value : `0x${value}`) as Hex;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error(`${name} is not a 32-byte hex private key`);
  return privateKeyToAccount(key);
}

// ---------------------------------------------------------------- markets, as the chain sees them

export interface AssetInfo {
  index: number;
  symbol: StockSymbol;
  address: Address;
  feed: Address;
}

export interface MarketInfo {
  key: MarketKey;
  label: string;
  address: Address;
  venue: Address;
  usdg: Address;
  maxPriceAge: number;
  assets: AssetInfo[];
}

export async function readMarket(client: PublicClient, cfg: NetConfig, key: MarketKey): Promise<MarketInfo> {
  const address = cfg.markets[key];
  const m = { address, abi: bondlineMarketAbi } as const;
  const [label, venue, usdg, maxPriceAge, assets, feeds] = await Promise.all([
    client.readContract({ ...m, functionName: "label" }),
    client.readContract({ ...m, functionName: "venue" }),
    client.readContract({ ...m, functionName: "usdg" }),
    client.readContract({ ...m, functionName: "maxPriceAge" }),
    client.readContract({ ...m, functionName: "assets" }),
    client.readContract({ ...m, functionName: "feeds" }),
  ]);
  const infos: AssetInfo[] = [];
  for (let i = 0; i < assets.length; i++) {
    let symbol = STOCK_SYMBOLS.find((s) => cfg.stocks[s].toLowerCase() === assets[i].toLowerCase());
    if (!symbol) {
      const onchain = await client.readContract({ address: assets[i], abi: erc20Abi, functionName: "symbol" });
      symbol = STOCK_SYMBOLS.find((s) => s === onchain);
    }
    if (!symbol) throw new Error(`${key} market asset ${assets[i]} is neither TSLA nor AMZN`);
    infos.push({ index: i, symbol, address: getAddress(assets[i]), feed: getAddress(feeds[i]) });
  }
  if (usdg.toLowerCase() !== cfg.usdg.toLowerCase()) {
    throw new Error(`${key} market uses USDG ${usdg}, but the deployment says ${cfg.usdg}`);
  }
  return { key, label, address, venue: getAddress(venue), usdg: getAddress(usdg), maxPriceAge: Number(maxPriceAge), assets: infos };
}

export async function readMarkets(client: PublicClient, cfg: NetConfig): Promise<Record<MarketKey, MarketInfo>> {
  const [live, replay] = await Promise.all(MARKET_KEYS.map((k) => readMarket(client, cfg, k)));
  return { live, replay };
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export const nowSec = () => Math.floor(Date.now() / 1000);
export const iso = (sec: number | bigint) => new Date(Number(sec) * 1000).toISOString();

export function envNumber(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number`);
  return n;
}
