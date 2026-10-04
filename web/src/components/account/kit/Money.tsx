"use client";

import NumberFlow, { type Format } from "@number-flow/react";
import { formatUnits } from "viem";
import { cn } from "@/lib/cn";
import { Skeleton } from "@/components/ui/Skeleton";

const usd = (cents: boolean): Intl.NumberFormatOptions => ({
  style: "currency",
  currency: "USD",
  minimumFractionDigits: cents ? 2 : 0,
  maximumFractionDigits: cents ? 2 : 0,
});

export const toDollars = (amount: bigint) => Number(formatUnits(amount, 6));

/** A USDG amount as dollars in Geist Mono, animated with NumberFlow. `undefined` shows a skeleton. */
export function Usd({
  amount,
  cents = true,
  signed = false,
  className,
  skeleton = "h-[1em] w-16",
}: {
  amount: bigint | undefined;
  cents?: boolean;
  /** Show a + before gains (losses always get a minus). */
  signed?: boolean;
  className?: string;
  skeleton?: string;
}) {
  if (amount === undefined) return <Skeleton className={cn("inline-block align-middle", skeleton)} />;
  const value = toDollars(amount);
  return (
    <span className={cn("num", className)}>
      <NumberFlow
        value={value}
        format={{ ...usd(cents), signDisplay: signed ? "exceptZero" : "auto" } as Format}
        locales="en-US"
      />
    </span>
  );
}

/** A percentage in Geist Mono, animated. `value` is a fraction (0.1 = 10%). */
export function Pct({
  value,
  digits = 1,
  signed = false,
  className,
}: {
  value: number | undefined;
  digits?: number;
  signed?: boolean;
  className?: string;
}) {
  if (value === undefined || !Number.isFinite(value)) {
    return <Skeleton className="inline-block h-[1em] w-12 align-middle" />;
  }
  return (
    <span className={cn("num", className)}>
      <NumberFlow
        value={value}
        format={
          {
            style: "percent",
            minimumFractionDigits: 0,
            maximumFractionDigits: digits,
            signDisplay: signed ? "exceptZero" : "auto",
          } as Format
        }
        locales="en-US"
      />
    </span>
  );
}
