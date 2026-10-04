"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";

/** Seconds since the epoch, ticking every second after mount; null on the server and first paint (no mismatch). */
function useNowSeconds(): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Math.floor(Date.now() / 1000));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * A countdown to a unix time (seconds), in big mono digits. After the moment it shows `doneLabel`.
 * Reserves its own height so nothing shifts when the clock starts.
 */
export function Countdown({
  target,
  doneLabel,
  className,
}: {
  target: number;
  doneLabel: string;
  className?: string;
}) {
  const now = useNowSeconds();
  const left = now == null ? null : target - now;
  if (left != null && left <= 0) {
    return (
      <p className={cn("flex min-h-[64px] items-center font-display text-display-s text-ink sm:min-h-[76px]", className)}>
        {doneLabel}
      </p>
    );
  }
  const total = left ?? 0;
  const cells = [
    ["Days", "Days", Math.floor(total / 86_400)],
    ["Hours", "Hrs", Math.floor((total % 86_400) / 3600)],
    ["Minutes", "Min", Math.floor((total % 3600) / 60)],
    ["Seconds", "Sec", total % 60],
  ] as const;
  return (
    <div
      role="timer"
      aria-label={left == null ? "Countdown" : `${cells.map(([l, , v]) => `${v} ${l.toLowerCase()}`).join(", ")} left`}
      className={cn("flex min-h-[64px] items-end gap-2 sm:min-h-[76px] sm:gap-5", className)}
    >
      {cells.map(([label, short, value], i) => (
        <div key={label} className="flex items-end gap-2 sm:gap-5">
          <div>
            <div className="num text-[34px] leading-none tracking-[-0.03em] text-ink sm:text-[56px]">
              {left == null ? "––" : pad(value)}
            </div>
            <div className="eyebrow mt-2"><span className="sm:hidden">{short}</span><span className="hidden sm:inline">{label}</span></div>
          </div>
          {i < cells.length - 1 ? <span aria-hidden="true" className="num pb-6 text-[22px] leading-none text-ink-4 sm:pb-8 sm:text-[40px]">:</span> : null}
        </div>
      ))}
    </div>
  );
}
