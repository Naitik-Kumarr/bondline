"use client";

import NumberFlow, { type Format } from "@number-flow/react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { usdFormat } from "@/lib/format";
import { Skeleton } from "./Skeleton";

type StatSize = "sm" | "md" | "lg";
type StatTone = "ink" | "bond" | "accent" | "positive" | "negative";

const valueSizes: Record<StatSize, string> = {
  sm: "text-lg",
  md: "text-[26px] sm:text-[28px]",
  lg: "text-[34px] sm:text-[44px]",
};

const skeletonSizes: Record<StatSize, string> = {
  sm: "h-[22px] w-20",
  md: "h-[30px] w-28",
  lg: "h-[44px] w-36",
};

const tones: Record<StatTone, string> = {
  ink: "text-ink",
  bond: "text-bond-ink",
  accent: "text-accent-ink",
  positive: "text-positive",
  negative: "text-negative",
};

export type StatProps = {
  label: ReactNode;
  /** The number. `undefined` (or `loading`) shows a skeleton of the same height. */
  value: number | undefined;
  /** Intl number format. Use `usd` for dollar amounts. */
  format?: Format;
  /** Shortcut for a USD currency format (whole dollars unless there are cents). */
  usd?: boolean;
  prefix?: string;
  suffix?: string;
  /** A line under the value: source, unit, caveat. */
  hint?: ReactNode;
  loading?: boolean;
  size?: StatSize;
  tone?: StatTone;
  align?: "left" | "right";
  className?: string;
};

/** Label + an animated number in Geist Mono with tabular figures. */
export function Stat({
  label,
  value,
  format,
  usd,
  prefix,
  suffix,
  hint,
  loading,
  size = "md",
  tone = "ink",
  align = "left",
  className,
}: StatProps) {
  const ready = !loading && value !== undefined && Number.isFinite(value);
  const fmt = format ?? (usd && ready ? (usdFormat(value) as Format) : undefined);
  return (
    <div className={cn("min-w-0", align === "right" && "text-right", className)}>
      <div className="text-[13px] text-ink-3">{label}</div>
      <div className={cn("num mt-1.5 leading-none tracking-[-0.02em]", valueSizes[size], tones[tone])}>
        {ready ? (
          <NumberFlow value={value} format={fmt} prefix={prefix} suffix={suffix} locales="en-US" />
        ) : (
          <Skeleton className={cn(skeletonSizes[size], align === "right" && "ml-auto")} />
        )}
      </div>
      {hint ? <div className="mt-2 text-[12.5px] leading-snug text-ink-3">{hint}</div> : null}
    </div>
  );
}
