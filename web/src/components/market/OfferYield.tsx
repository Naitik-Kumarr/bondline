import { Pill } from "@/components/ui/Pill";
import type { OfferView } from "@/lib/bondline/book";
import { duration, usd, usdgToUsd } from "./fmt";
import { getOfferYields, offerKey } from "./yield";

const signed = (share: number) => {
  const p = share * 100;
  const digits = Math.abs(p) >= 100 ? 0 : 1;
  const text = Math.abs(p).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${p < 0 ? "−" : p > 0 ? "+" : ""}${text}%`;
};

/**
 * What this offer has paid its underwriter, annualised from the offer's age, with the window and the dollars behind
 * it. Testnet and short: it swings with one premium or claim, and the line says so.
 */
export async function OfferYield({ offer }: { offer: OfferView }) {
  const yields = await getOfferYields();
  const y = yields?.get(offerKey(offer));
  if (!y) return null;
  const short = y.windowSeconds < 7 * 86_400;
  return (
    <div className="mt-4 rounded-field bg-bond-tint px-3 py-2.5 text-[12.5px] leading-relaxed text-ink-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-ink-3">Underwriter yield</span>
        {short && y.periodReturn != null ? (
          // Under a week, lead with what was actually earned: annualising hours of premiums gives a huge, meaningless APY.
          <>
            <span className="num text-[15px] text-ink">{signed(y.periodReturn)}</span>
            <span className="text-ink-3">earned so far</span>
          </>
        ) : y.apy != null ? (
          <span className="num text-[15px] text-ink">{signed(y.apy)} APY</span>
        ) : (
          <span className="num text-ink">n/a</span>
        )}
        <Pill size="sm" tone={short ? "caution" : "neutral"}>
          measured over {duration(y.windowSeconds)}
        </Pill>
      </div>
      <p className="mt-1 text-ink-3">
        {y.periodReturn != null ? (
          <>
            Premiums <span className="num text-ink-2">{usd(usdgToUsd(y.premiums), { cents: true })}</span> minus claims{" "}
            <span className="num text-ink-2">{usd(usdgToUsd(y.claims), { cents: true })}</span> on{" "}
            <span className="num text-ink-2">{usd(usdgToUsd(y.capital), { cents: true })}</span> put in
            {short ? (
              y.apy != null ? (
                <>
                  . Scaled simply to a year that is <span className="num text-ink-2">{signed(y.apy)}</span> APY, which
                  means little yet: premiums are paid up front, so a window under a week inflates it.{" "}
                </>
              ) : (
                ". "
              )
            ) : (
              <>
                : <span className="num text-ink-2">{signed(y.periodReturn)}</span> earned in that window, scaled simply
                to a year.{" "}
              </>
            )}
          </>
        ) : null}
        Testnet.
      </p>
    </div>
  );
}
