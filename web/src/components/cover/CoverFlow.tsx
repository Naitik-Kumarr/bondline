"use client";

import { isDeployed } from "@bondline/shared/deployment";
import { useMemo, useState } from "react";
import { isAddress } from "viem";
import { useAccount } from "wagmi";
import { Card } from "@/components/ui/Card";
import { Container } from "@/components/ui/Container";
import { AlertIcon } from "@/components/ui/icons";
import { Skeleton } from "@/components/ui/Skeleton";
import { defaultRules, type Rules } from "@/lib/bondline/actions";
import { usdg as fmtUsdg } from "@/lib/bondline/format";
import { agentOf, defaultPriceAge, marketByKey } from "@/components/account/kit/bondline";
import { Field, NumberInput } from "@/components/account/kit/Fields";
import { useOffers, type LiveOffer } from "@/components/account/kit/useOffers";
import { useWalletFunds } from "@/components/account/kit/useWalletFunds";
import { CoverSummary } from "./CoverSummary";
import { LimitPicker, snapLimit } from "./LimitPicker";
import { maxDeposit, parseUsdg } from "./math";
import { OfferPicker, offerKey } from "./OfferPicker";
import { RulesEditor, type RulesState } from "./RulesEditor";
import { YourCovers } from "./YourCovers";

/** The agent's default rules for this offer: the persona's, capped by the offer, with the market's price age. */
export function rulesFor(offer: LiveOffer): Rules {
  const market = marketByKey(offer.market)!;
  const persona = agentOf(offer.agent)?.key ?? "careful";
  const r = defaultRules(persona, defaultPriceAge(market));
  return { ...r, maxStockBps: Math.min(r.maxStockBps, offer.terms.maxStockBps) };
}

function pickInitial(offers: LiveOffer[], market?: string, offer?: string): string | undefined {
  const listed = offers.filter((o) => o.listed);
  const wanted = offers.find(
    (o) =>
      (market === undefined || o.market === market) &&
      offer !== undefined &&
      (isAddress(offer) ? o.cover.toLowerCase() === offer.toLowerCase() : String(o.id) === offer),
  );
  if (wanted) return offerKey(wanted);
  const inMarket = listed.filter((o) => market === undefined || o.market === market);
  const pool = inMarket.length ? inMarket : listed;
  // Most free bond first, so the first suggestion can take a deposit.
  return pool.length ? offerKey([...pool].sort((a, b) => (b.free > a.free ? 1 : b.free < a.free ? -1 : 0))[0]) : undefined;
}

/** What the cover pays, in the spec's words. */
function HowItPays() {
  return (
    <Card tone="sunken" padding="sm" className="mt-4">
      <p className="eyebrow mb-2">How the cover pays</p>
      <p className="text-[13.5px] leading-relaxed text-ink-2">
        Once your loss passes your limit, anyone can call settle. It stops the agent and pays once only if the
        required prices are fresh and the USDG transfer succeeds: the loss beyond your limit at that moment, up to a 30%
        drop. USDG pause/freeze controls and unsolicited listed-stock dust can block settlement in the current code. The
        keeper attempts settlement while it is running; transaction latency, stale prices and failed transfers can delay
        it. The stocks stay in your account.
      </p>
      <p className="mt-2 text-[13.5px] leading-relaxed text-ink-2">
        A stop-loss can&apos;t do this when the price jumps through your limit (a weekend or overnight gap, news),
        because nothing sells inside a gap. The bond pays the gap.
      </p>
    </Card>
  );
}

function Step({ n, title, lead, children }: { n: number; title: string; lead?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card as="section" aria-labelledby={`step-${n}`}>
      <div className="mb-5 flex items-start gap-3">
        <span className="num mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-sunken text-[12.5px] text-ink-2">
          {n}
        </span>
        <div className="min-w-0">
          <h2 id={`step-${n}`} className="text-[18px] font-medium tracking-[-0.01em] text-ink">
            {title}
          </h2>
          {lead ? <p className="mt-1 text-[14px] leading-relaxed text-ink-3">{lead}</p> : null}
        </div>
      </div>
      {children}
    </Card>
  );
}

export function CoverFlow({ initialMarket, initialOffer }: { initialMarket?: string; initialOffer?: string }) {
  const { address } = useAccount();
  const offersQ = useOffers({ withAccounts: true });
  const funds = useWalletFunds(address);
  const offers = offersQ.data;
  const visible = useMemo(() => offers?.filter((o) => o.listed), [offers]);

  const [chosen, setChosen] = useState<string | undefined>(undefined);
  const selectedKey = chosen ?? (offers ? pickInitial(offers, initialMarket, initialOffer) : undefined);
  const offer = offers?.find((o) => offerKey(o) === selectedKey);
  const pool = offer && !offer.listed && visible ? [offer, ...visible] : visible;

  const [limitByOffer, setLimitByOffer] = useState<Record<string, number>>({});
  const limitBps = offer
    ? (limitByOffer[offerKey(offer)] ?? snapLimit(1000, offer.terms.minLimitBps, offer.terms.maxLimitBps))
    : 1000;

  const defaults = useMemo(() => (offer ? rulesFor(offer) : null), [offer]);
  const [rulesState, setRulesState] = useState<{ key: string; state: RulesState } | null>(null);
  const rules = offer && rulesState?.key === offerKey(offer) ? rulesState.state : null;

  const [amountText, setAmountText] = useState("100");
  const amount = parseUsdg(amountText);
  const room = offer ? maxDeposit(offer.free, offer.terms.feeBps, limitBps) : null;

  if (!isDeployed) {
    return (
      <Container className="mt-10">
        <Card tone="sunken">Bondline isn&apos;t deployed on this network yet.</Card>
      </Container>
    );
  }

  const market = offer ? marketByKey(offer.market) : undefined;

  return (
    <Container className="mt-10 sm:mt-14">
      {offersQ.error ? (
        <Card tone="sunken" className="mb-6 flex items-start gap-3" role="alert">
          <AlertIcon size={18} className="mt-0.5 shrink-0 text-caution" />
          <p className="text-[15px] text-ink-2">
            Couldn&apos;t read the offers from the chain. It retries every few seconds.
          </p>
        </Card>
      ) : null}
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-6">
        <div className="flex min-w-0 flex-col gap-5">
          <Step
            n={1}
            title="Choose an offer"
            lead="Each offer is one underwriter's USDG bond behind one AI agent, with its premium and the limits it takes."
          >
            <OfferPicker offers={pool} selected={selectedKey} onSelect={setChosen} />
            {market ? <p className="mt-4 text-[13px] leading-relaxed text-ink-3">{market.note}</p> : null}
          </Step>

          <Step
            n={2}
            title="Your loss limit"
            lead="You carry the loss up to your limit. Past it, anyone can call settle. It stops the agent and pays once only if the required prices are fresh and the USDG transfer succeeds: the loss beyond your limit, up to a 30% drop."
          >
            {offer ? (
              <LimitPicker
                value={limitBps}
                min={offer.terms.minLimitBps}
                max={offer.terms.maxLimitBps}
                onChange={(bps) => setLimitByOffer((m) => ({ ...m, [offerKey(offer)]: bps }))}
              />
            ) : (
              <Skeleton rounded="lg" className="h-[168px]" />
            )}
          </Step>

          <Step
            n={3}
            title="Rules every trade must pass"
            lead="Fixed on-chain when the cover opens. A trade outside them is refused, and the refusal is recorded."
          >
            {offer && defaults ? (
              <RulesEditor
                key={offerKey(offer)}
                defaults={defaults}
                onChange={(state) => setRulesState({ key: offerKey(offer), state })}
              />
            ) : (
              <Skeleton rounded="lg" className="h-[150px]" />
            )}
          </Step>

          <Step n={4} title="Deposit" lead="USDG into your covered account. The premium comes out of it once.">
            <Field
              label="Amount"
              htmlFor="deposit"
              aside={
                address ? (
                  <button
                    type="button"
                    className="num text-ink-2 underline decoration-ink/20 underline-offset-4 hover:text-ink"
                    onClick={() => {
                      if (funds.usdg === undefined) return;
                      const cap = room !== null && room < funds.usdg ? room : funds.usdg;
                      setAmountText(fmtUsdg(cap).replace(/,/g, ""));
                    }}
                  >
                    Balance {funds.usdg === undefined ? "…" : fmtUsdg(funds.usdg)} USDG
                  </button>
                ) : null
              }
              hint={
                room !== null ? (
                  <>
                    At this limit, this offer&apos;s free bond can back deposits up to{" "}
                    <span className="num text-ink-2">{fmtUsdg(room)}</span> USDG. The smallest is 1 USDG.
                  </>
                ) : (
                  "The smallest deposit is 1 USDG."
                )
              }
            >
              <NumberInput id="deposit" value={amountText} onChange={setAmountText} unit="USDG" placeholder="100" />
            </Field>
          </Step>
        </div>

        <div className="min-w-0 lg:sticky lg:top-24">
          {offer && defaults ? (
            <CoverSummary
              key={offerKey(offer)}
              offer={offer}
              limitBps={limitBps}
              rules={rules?.rules ?? defaults}
              rulesError={rules?.error ?? null}
              amount={amount}
              amountText={amountText}
              onOpened={() => void offersQ.refetch()}
            />
          ) : (
            <Card aria-busy="true" aria-label="Loading the cover">
              <Skeleton className="h-4 w-24" rounded="sm" />
              <Skeleton className="mt-3 h-6 w-48" rounded="sm" />
              <Skeleton className="mt-6 h-[220px]" rounded="lg" />
              <Skeleton className="mt-6 h-12" rounded="full" />
            </Card>
          )}
          <HowItPays />
        </div>
      </div>

      <YourCovers offers={offers} />
    </Container>
  );
}
