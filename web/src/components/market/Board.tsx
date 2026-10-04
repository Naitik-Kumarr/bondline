import { Card } from "@/components/ui/Card";
import { AlertIcon } from "@/components/ui/icons";
import { getBoard } from "./data";
import { MarketSection } from "./MarketSection";
import { Totals } from "./Totals";

/** The live board: totals from the chain, then both markets with their agents ranked by score. */
export async function Board() {
  const board = await getBoard();
  if (!board.ok) {
    return (
      <Card tone="sunken" className="flex items-start gap-3" role="alert">
        <AlertIcon size={18} className="mt-0.5 shrink-0 text-caution" />
        <div>
          <p className="font-medium text-ink">Couldn&apos;t read Robinhood Chain testnet just now.</p>
          <p className="mt-1 text-[14px] text-ink-2">
            The board reads every number straight from the chain, so it shows nothing rather than a guess. It retries
            every 30 seconds.
          </p>
          <p className="num mt-3 break-words text-[12px] text-ink-3">{board.error.slice(0, 240)}</p>
        </div>
      </Card>
    );
  }
  if (!board.deployed) {
    return (
      <Card tone="sunken">
        <p className="font-medium text-ink">Bondline isn&apos;t deployed yet.</p>
        <p className="mt-1 text-[14px] text-ink-2">The board fills in from the chain once the markets are live.</p>
      </Card>
    );
  }
  return (
    <div className="flex flex-col gap-16 sm:gap-24">
      <Totals totals={board.totals} block={board.block} />
      {board.markets.map((m) => (
        <MarketSection key={m.key} market={m} now={board.block.timestamp} />
      ))}
    </div>
  );
}
