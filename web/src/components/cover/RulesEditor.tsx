"use client";

import { STOCK_SYMBOLS } from "@bondline/shared/constants";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { formatBps } from "@/lib/format";
import type { Rules } from "@/lib/bondline/actions";
import { formatAge } from "@/components/account/kit/bondline";
import { NumberInput } from "@/components/account/kit/Fields";

type Key = "maxStockBps" | "maxTradeBps" | "maxDailyBps" | "maxSlippageBps" | "maxPriceAge";

interface Spec {
  key: Key;
  label: string;
  hint: string;
  unit: string;
  /** Smallest allowed value, in the rule's own unit (bps or seconds). */
  min: number;
  toText: (v: number) => string;
  fromText: (t: string) => number;
  show: (v: number) => string;
}

const pct = { toText: (v: number) => String(v / 100), fromText: (t: string) => Math.round(Number(t) * 100) };

const SPECS: Spec[] = [
  { key: "maxStockBps", label: "Most in stocks", hint: "Share of the account's value, after a buy", unit: "%", min: 100, ...pct, show: (v) => formatBps(v) },
  { key: "maxTradeBps", label: "Largest trade", hint: "Share of the account's value", unit: "%", min: 1, ...pct, show: (v) => formatBps(v) },
  { key: "maxDailyBps", label: "Traded per day", hint: "Share of the account's value, per UTC day", unit: "%", min: 1, ...pct, show: (v) => formatBps(v) },
  {
    key: "maxSlippageBps",
    label: "Worst fill",
    hint: "Below the oracle price; the demo exchange's spread is 0.1%",
    unit: "%",
    min: 10,
    ...pct,
    show: (v) => formatBps(v),
  },
  {
    key: "maxPriceAge",
    label: "Oldest price",
    hint: "The agent waits when prices are older",
    unit: "min",
    min: 30,
    toText: (v) => String(Math.round((v / 60) * 10) / 10),
    fromText: (t) => Math.round(Number(t) * 60),
    show: (v) => formatAge(v),
  },
];

export interface RulesState {
  rules: Rules;
  error: string | null;
}

/**
 * The rules every trade must pass, fixed on-chain when the cover opens. They start at the agent's defaults and can
 * only be tightened: every limit's ceiling is its default (and the offer's own cap on stocks).
 */
export function RulesEditor({
  defaults,
  onChange,
}: {
  /** Also the ceilings. */
  defaults: Rules;
  onChange: (state: RulesState) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [mask, setMask] = useState(defaults.assetMask);
  const [text, setText] = useState<Record<Key, string>>(
    () => Object.fromEntries(SPECS.map((s) => [s.key, s.toText(defaults[s.key])])) as Record<Key, string>,
  );

  const errorOf = (s: Spec, t: string): string | null => {
    if (t.trim() === "" || !Number.isFinite(Number(t))) return "Enter a number";
    const v = s.fromText(t);
    if (v < s.min) return `At least ${s.show(s.min)}`;
    if (v > defaults[s.key]) return `At most ${s.show(defaults[s.key])}`;
    return null;
  };

  const emit = (nextMask: number, nextText: Record<Key, string>) => {
    const errors = SPECS.map((s) => errorOf(s, nextText[s.key])).filter(Boolean);
    const rules: Rules = { ...defaults, assetMask: nextMask };
    for (const s of SPECS) if (!errorOf(s, nextText[s.key])) rules[s.key] = s.fromText(nextText[s.key]);
    onChange({
      rules,
      error: nextMask === 0 ? "Allow at least one stock." : errors.length ? "Fix the highlighted rules." : null,
    });
  };

  const toggleStock = (bit: number) => {
    const next = mask ^ (1 << bit);
    setMask(next);
    emit(next, text);
  };

  const reset = () => {
    const t = Object.fromEntries(SPECS.map((s) => [s.key, s.toText(defaults[s.key])])) as Record<Key, string>;
    setMask(defaults.assetMask);
    setText(t);
    emit(defaults.assetMask, t);
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-[13px] text-ink-3">Stocks</span>
        {STOCK_SYMBOLS.map((symbol, bit) => {
          const allowed = (defaults.assetMask & (1 << bit)) !== 0;
          const on = (mask & (1 << bit)) !== 0;
          return (
            <button
              key={symbol}
              type="button"
              aria-pressed={on}
              disabled={!allowed}
              onClick={() => toggleStock(bit)}
              className={cn(
                "num inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] transition-colors",
                on ? "bg-ink text-white" : "bg-surface text-ink-3 shadow-hairline line-through decoration-ink-4",
              )}
            >
              {symbol}
            </button>
          );
        })}
        {mask === 0 ? <span className="text-[13px] text-negative">Allow at least one stock.</span> : null}
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-3">
        {SPECS.map((s) => {
          const err = errorOf(s, text[s.key]);
          return (
            <div key={s.key} className="min-w-0">
              <dt className="text-[13px] text-ink-3">{s.label}</dt>
              <dd className="mt-1">
                {editing ? (
                  <>
                    <NumberInput
                      value={text[s.key]}
                      unit={s.unit}
                      decimals={2}
                      invalid={Boolean(err)}
                      ariaLabel={s.label}
                      className="h-10 px-3"
                      onChange={(v) => {
                        const next = { ...text, [s.key]: v };
                        setText(next);
                        emit(mask, next);
                      }}
                    />
                    <p className={cn("mt-1 text-[11.5px] leading-snug", err ? "text-negative" : "text-ink-3")}>
                      {err ?? `Up to ${s.show(defaults[s.key])}`}
                    </p>
                  </>
                ) : (
                  <span className="num text-[16px] text-ink">
                    {err ? s.show(defaults[s.key]) : s.show(s.fromText(text[s.key]))}
                  </span>
                )}
              </dd>
            </div>
          );
        })}
      </dl>

      <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px]">
        <button
          type="button"
          onClick={() => setEditing((v) => !v)}
          className="font-medium text-ink underline decoration-ink/25 underline-offset-4 hover:decoration-ink"
        >
          {editing ? "Done" : "Tighten the rules"}
        </button>
        {editing ? (
          <button type="button" onClick={reset} className="text-ink-2 hover:text-ink">
            Back to defaults
          </button>
        ) : null}
        <span className="text-ink-3">You can tighten them, never loosen them.</span>
      </div>
    </div>
  );
}
