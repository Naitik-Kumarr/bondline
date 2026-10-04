"use client";

import { CAP_BPS } from "@bondline/shared/constants";
import { formatBps } from "@/lib/format";
import { usdg as fmtUsdg } from "@/lib/bondline/format";
import type { AgentInfo } from "@/components/account/kit/bondline";
import { FaucetLinks } from "@/components/account/kit/Checks";
import { Field, NumberInput, TextInput } from "@/components/account/kit/Fields";
import { maxDeposit } from "@/components/cover/math";
import { priceAt, type AgentPriceTable } from "./price-lookup";
import { nameBytes, suggestName, validateTerms, type TermsDraft } from "./terms";

const pct = (bps: number | null) =>
  bps === null ? "—" : `${(bps / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;

/** Step 2: the limits buyers may choose, the premium, the bond and a name. The stock cap comes from the persona. */
export function TermsStep({
  agent,
  table,
  draft,
  onChange,
  balance,
  connected,
}: {
  agent: AgentInfo;
  table: AgentPriceTable;
  draft: TermsDraft;
  onChange: (draft: TermsDraft) => void;
  balance: bigint | undefined;
  connected: boolean;
}) {
  const { valid, errors } = validateTerms(draft, agent);
  const set = (patch: Partial<TermsDraft>) => {
    const next = { ...draft, ...patch };
    if (!next.nameEdited && patch.fee !== undefined) next.name = suggestName(agent, patch.fee);
    onChange(next);
  };

  const min = valid?.terms.minLimitBps;
  const max = valid?.terms.maxLimitBps;
  const fee = valid?.terms.feeBps;
  const at = (bps: number) => `${(bps / CAP_BPS) * 100}%`;
  const worstMin = min !== undefined ? priceAt(table.worst, min) : null;
  const worstMax = max !== undefined ? priceAt(table.worst, max) : null;
  const recordMin = min !== undefined && table.record ? priceAt(table.record, min) : null;
  const recordMax = max !== undefined && table.record ? priceAt(table.record, max) : null;
  const below = fee !== undefined && worstMin !== null && fee < worstMin;

  const bond = valid?.bond;
  const backsAtMin = bond !== undefined && min !== undefined && fee !== undefined ? maxDeposit(bond, fee, min) : null;
  const backsAtMax = bond !== undefined && max !== undefined && fee !== undefined ? maxDeposit(bond, fee, max) : null;
  const short = connected && bond !== undefined && balance !== undefined && balance < bond;

  return (
    <div className="grid gap-x-10 gap-y-8 lg:grid-cols-2">
      <div className="flex flex-col gap-8">
        <div>
          <div className="mb-2 text-[14px] font-medium text-ink">Limits buyers can choose</div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={<span className="text-[13px] font-normal text-ink-3">From</span>} error={errors.minLimit}>
              <NumberInput
                value={draft.minLimit}
                onChange={(v) => set({ minLimit: v })}
                unit="%"
                decimals={2}
                invalid={Boolean(errors.minLimit)}
                ariaLabel="Smallest limit"
              />
            </Field>
            <Field label={<span className="text-[13px] font-normal text-ink-3">To</span>} error={errors.maxLimit}>
              <NumberInput
                value={draft.maxLimit}
                onChange={(v) => set({ maxLimit: v })}
                unit="%"
                decimals={2}
                invalid={Boolean(errors.maxLimit)}
                ariaLabel="Largest limit"
              />
            </Field>
          </div>
          <div className="mt-4" aria-hidden="true">
            <div className="relative h-7 overflow-hidden rounded-[9px] bg-sunken">
              {min !== undefined && max !== undefined ? (
                <div
                  className="absolute inset-y-0 bg-accent-soft"
                  style={{ left: at(min), width: `calc(${at(max)} - ${at(min)})` }}
                />
              ) : null}
              {min !== undefined ? (
                <div className="absolute inset-y-0 border-l-[1.5px] border-dashed border-accent" style={{ left: at(min) }} />
              ) : null}
              {max !== undefined ? (
                <div className="absolute inset-y-0 border-l-[1.5px] border-dashed border-accent" style={{ left: at(max) }} />
              ) : null}
            </div>
            <div className="num mt-1.5 flex justify-between text-[11.5px] text-ink-3">
              <span>0%</span>
              <span>30% cap</span>
            </div>
          </div>
          <p className="mt-2 text-[12.5px] leading-snug text-ink-3">
            A deposit at limit L reserves (30% − L) of it from your bond, rounded up. Smaller limits pay out more, so
            they need more bond.
          </p>
        </div>

        <Field
          label="Premium"
          htmlFor="fee"
          error={errors.fee}
          hint={`Taken once from every deposit and added to your bond. At most 5%.`}
        >
          <NumberInput
            id="fee"
            value={draft.fee}
            onChange={(v) => set({ fee: v })}
            unit="% of each deposit"
            decimals={2}
            invalid={Boolean(errors.fee)}
          />
        </Field>
        <div className="-mt-4 rounded-card bg-sunken px-4 py-3.5 text-[13px] leading-relaxed text-ink-2">
          <div className="eyebrow mb-1.5">Model reference, {agent.name}</div>
          At the maximum stock share allowed after a buy: <span className="num text-ink">{pct(worstMin)}</span> at a{" "}
          {min !== undefined ? formatBps(min) : "—"} limit, <span className="num text-ink">{pct(worstMax)}</span> at{" "}
          {max !== undefined ? formatBps(max) : "—"}.{" "}
          {table.record ? (
            <>
              Its record: <span className="num text-accent-ink">{pct(recordMin)}</span> to{" "}
              <span className="num text-accent-ink">{pct(recordMax)}</span>.
            </>
          ) : (
            <>No record price yet.</>
          )}{" "}
          For 30 days of cover; a simple published model, not actuarial.
          {below ? (
            <div className="mt-1.5 text-caution">
              Your premium is below the model&apos;s reference price at the maximum stock share, at your smallest limit.
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-8">
        <Field
          label="Bond"
          htmlFor="bond"
          error={errors.bond}
          aside={
            connected ? (
              <button
                type="button"
                className="num text-ink-2 underline decoration-ink/20 underline-offset-4 hover:text-ink"
                onClick={() => balance !== undefined && set({ bond: fmtUsdg(balance).replace(/,/g, "") })}
              >
                Balance {balance === undefined ? "…" : fmtUsdg(balance)} USDG
              </button>
            ) : null
          }
        >
          <NumberInput id="bond" value={draft.bond} onChange={(v) => set({ bond: v })} unit="USDG" invalid={Boolean(errors.bond)} />
        </Field>
        <div className="-mt-5 text-[12.5px] leading-relaxed text-ink-3">
          {short ? (
            <p className="mb-1.5 text-ink-2">
              Your wallet holds less than this bond. <FaucetLinks need="usdg" />
            </p>
          ) : null}
          {backsAtMin !== null || backsAtMax !== null ? (
            <p>
              It backs deposits up to about{" "}
              <span className="num text-ink-2">{backsAtMin === null ? "any size" : `$${fmtUsdg(backsAtMin, 0)}`}</span> at a{" "}
              {formatBps(min!)} limit, or{" "}
              <span className="num text-ink-2">{backsAtMax === null ? "any size" : `$${fmtUsdg(backsAtMax, 0)}`}</span> at{" "}
              {formatBps(max!)}, and grows with every premium. You can release free bond at any time; reserved bond
              backs active covers.
            </p>
          ) : null}
        </div>

        <div>
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <span className="text-[14px] font-medium text-ink">Most in stocks</span>
            <span className="text-[12.5px] text-ink-3">From the persona</span>
          </div>
          <div className="flex h-12 items-center justify-between rounded-field bg-sunken px-4">
            <span className="num text-[17px] text-ink">{formatBps(agent.maxStockBps)}</span>
            <span className="text-[13px] text-ink-3">{agent.name}&apos;s cap</span>
          </div>
          <p className="mt-2 text-[12.5px] leading-snug text-ink-3">
            Every covered account&apos;s rules must keep at most this share in stocks. Buyers can set it lower.
          </p>
        </div>

        <Field
          label="Offer name"
          htmlFor="offer-name"
          error={errors.name}
          aside={<span className="num">{nameBytes(draft.name.trim())}/64</span>}
        >
          <TextInput
            id="offer-name"
            value={draft.name}
            onChange={(v) => onChange({ ...draft, name: v, nameEdited: true })}
            invalid={Boolean(errors.name)}
            placeholder={suggestName(agent, draft.fee)}
          />
        </Field>
      </div>
    </div>
  );
}
