import type { MarketKey } from "@bondline/shared";
import type { Address } from "viem";
import { readExposure } from "./data";
import { ExposureChart } from "./ExposureChart";

/** Reads the stock share after every trade from the chain, then hands the points to the interactive chart. */
export async function ExposureLoader({
  accounts,
  cap,
  p95,
}: {
  accounts: { address: Address; market: MarketKey }[];
  cap: number | null;
  p95: number | null;
}) {
  const points = await readExposure(accounts);
  if (points === null) {
    return <p className="text-[14px] text-ink-2">Couldn&apos;t read the trades from the chain just now.</p>;
  }
  return <ExposureChart points={points.map((p) => ({ share: p.share, market: p.market }))} cap={cap} p95={p95} />;
}
