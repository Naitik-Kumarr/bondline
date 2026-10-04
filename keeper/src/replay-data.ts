// The replay's price history: real Chainlink TSLA/USD and AMZN/USD rounds from Robinhood Chain mainnet,
// 28 Sep 00:00 UTC to 3 Oct 00:00 UTC 2026, plus each feed's last round before the window (the opening value).
import data from "../data/replay-rounds.json" with { type: "json" };
import type { StockSymbol } from "@bondline/shared";

export interface Round {
  roundId: string;
  answer: bigint;
  updatedAt: number;
}

export interface Series {
  symbol: StockSymbol;
  proxy: string;
  decimals: number;
  /** The last round before the window: the answer until the first in-window round. */
  opening: Round | null;
  /** In-window rounds, oldest first. */
  rounds: Round[];
}

interface RawRound {
  roundId: string;
  answer: string;
  updatedAt: number;
}
interface RawSeries {
  proxy: string;
  decimals: number;
  opening?: RawRound;
  rounds: RawRound[];
}

const toRound = (r: RawRound): Round => ({ roundId: r.roundId, answer: BigInt(r.answer), updatedAt: r.updatedAt });

export function loadSeries(): Record<StockSymbol, Series> {
  const raw = data as unknown as Record<StockSymbol, RawSeries>;
  const out = {} as Record<StockSymbol, Series>;
  for (const symbol of ["TSLA", "AMZN"] as StockSymbol[]) {
    const s = raw[symbol];
    const rounds = s.rounds.map(toRound).sort((a, b) => a.updatedAt - b.updatedAt);
    out[symbol] = { symbol, proxy: s.proxy, decimals: s.decimals, opening: s.opening ? toRound(s.opening) : null, rounds };
  }
  return out;
}

/**
 * The answer at replay time `t`: the most recent real round at or before `t` (a step function, no
 * interpolation). Before the first in-window round it is the opening round; null if there is none.
 */
export function answerAt(series: Series, t: number): Round | null {
  const r = series.rounds;
  let lo = 0;
  let hi = r.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (r[mid].updatedAt <= t) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best >= 0 ? r[best] : series.opening;
}
