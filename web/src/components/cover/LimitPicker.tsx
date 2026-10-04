"use client";

import NumberFlow from "@number-flow/react";
import { CAP_BPS } from "@bondline/shared/constants";
import { formatBps } from "@/lib/format";
import { Slider } from "@/components/account/kit/Fields";

/** Snap to 0.5% steps inside the offer's range (the range ends always reachable). */
export function snapLimit(value: number, min: number, max: number) {
  const snapped = Math.round(value / 50) * 50;
  return Math.min(max, Math.max(min, snapped));
}

/** The loss limit: a slider inside the offer's range, and the band the bond pays drawn on a 0–30% scale. */
export function LimitPicker({
  value,
  min,
  max,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (bps: number) => void;
}) {
  const at = (bps: number) => `${(bps / CAP_BPS) * 100}%`;
  return (
    <div>
      <div className="flex items-end justify-between gap-4">
        <div className="num text-[44px] leading-none tracking-[-0.04em] text-ink sm:text-[52px]">
          <NumberFlow value={value / 10_000} format={{ style: "percent", maximumFractionDigits: 2 }} locales="en-US" />
        </div>
        <p className="max-w-[17rem] pb-1 text-right text-[13px] leading-snug text-ink-3">
          Offer range {formatBps(min)} to {formatBps(max)}
        </p>
      </div>
      <div className="mt-5">
        <Slider
          value={value}
          min={min}
          max={max}
          step={50}
          onChange={(v) => onChange(snapLimit(v, min, max))}
          ariaLabel="Loss limit"
          valueText={`${formatBps(value)} loss limit`}
        />
      </div>

      {/* The 0–30% scale: you carry up to the limit; the bond pays from the limit to the cap. */}
      <div className="mt-6" aria-hidden="true">
        <div className="relative h-9 overflow-hidden rounded-[10px] bg-sunken">
          <div className="absolute inset-y-0 left-0 bg-sunken-2" style={{ width: at(value) }} />
          <div
            className="absolute inset-y-0 right-0 bg-bond-soft"
            style={{
              left: at(value),
              backgroundImage:
                "repeating-linear-gradient(135deg, rgb(242 163 122 / 0.35) 0 1px, transparent 1px 7px)",
            }}
          />
          <div className="absolute inset-y-0 border-l-[1.5px] border-dashed border-accent" style={{ left: at(value) }} />
          <span className="absolute inset-y-0 left-3 flex items-center text-[12px] text-ink-2">You carry</span>
          <span className="absolute inset-y-0 right-3 flex items-center text-[12px] font-medium text-bond-ink">
            Bond pays
          </span>
        </div>
        <div className="num mt-1.5 flex justify-between text-[11.5px] text-ink-3">
          <span>0%</span>
          <span>30% drop</span>
        </div>
      </div>
    </div>
  );
}
