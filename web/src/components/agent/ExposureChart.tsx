"use client";

import { useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { cn } from "@/lib/cn";

export interface ChartPoint {
  share: number;
  market: string | null;
}

const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;

/**
 * The stock share after every trade, against the rules' cap (dashed periwinkle threshold) and the record's 95th
 * percentile (hairline). A crosshair snaps to the nearest trade on hover or with the arrow keys; every value is also
 * in the receipts below, so the tooltip never gates anything.
 */
export function ExposureChart({
  points,
  cap,
  p95,
  height = 180,
  className,
}: {
  points: ChartPoint[];
  cap: number | null;
  p95: number | null;
  height?: number;
  className?: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const tipId = useId();
  const n = points.length;

  if (n === 0) {
    return (
      <div
        className={cn("flex items-center justify-center rounded-card border border-dashed border-line-strong text-[13px] text-ink-3", className)}
        style={{ height }}
      >
        No trades yet
      </div>
    );
  }

  const W = 600;
  const H = height;
  const padTop = 14;
  const padBottom = 6;
  const top = Math.max(cap ?? 0, p95 ?? 0, ...points.map((p) => p.share), 0.05) * 1.12;
  const xPct = (i: number) => (n === 1 ? 50 : (i / (n - 1)) * 100);
  const yPx = (v: number) => padTop + (1 - v / top) * (H - padTop - padBottom);
  const line = points.map((p, i) => `${i ? "L" : "M"}${((xPct(i) / 100) * W).toFixed(2)} ${yPx(p.share).toFixed(2)}`).join("");
  const area = `${line}L${W} ${H}L0 ${H}Z`;
  const ticks = [0, cap ?? null].filter((t): t is number => t != null);

  const pick = (clientX: number) => {
    const r = box.current?.getBoundingClientRect();
    if (!r || r.width === 0) return;
    const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    setActive(n === 1 ? 0 : Math.round(f * (n - 1)));
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      setActive((i) => {
        const cur = i ?? (e.key === "ArrowRight" ? -1 : n);
        return Math.min(n - 1, Math.max(0, cur + (e.key === "ArrowRight" ? 1 : -1)));
      });
    } else if (e.key === "Escape") setActive(null);
  };

  const a = active != null ? points[active] : null;
  return (
    <div className={cn("relative", className)}>
      <div
        ref={box}
        tabIndex={0}
        role="img"
        aria-label={
          `Stock share after each of ${n} trades: latest ${pct(points[n - 1].share)}, highest ${pct(Math.max(...points.map((p) => p.share)))}` +
          (cap != null ? `, rules cap ${pct(cap, 0)}` : "") +
          (p95 != null ? `, 95th percentile ${pct(p95)}` : "") +
          ". Use the arrow keys to step through trades."
        }
        aria-describedby={a ? tipId : undefined}
        onPointerMove={(e: PointerEvent) => pick(e.clientX)}
        onPointerLeave={() => setActive(null)}
        onPointerDown={(e: PointerEvent) => pick(e.clientX)}
        onKeyDown={onKey}
        onBlur={() => setActive(null)}
        className="relative touch-pan-y rounded-[6px] outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        style={{ height }}
      >
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden="true">
          {ticks.map((t) => (
            <line key={t} x1="0" x2={W} y1={yPx(t)} y2={yPx(t)} stroke="var(--color-line)" vectorEffect="non-scaling-stroke" />
          ))}
          {cap != null ? (
            <line
              x1="0"
              x2={W}
              y1={yPx(cap)}
              y2={yPx(cap)}
              stroke="var(--color-accent)"
              strokeWidth="1.25"
              strokeDasharray="5 5"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
          {p95 != null ? (
            <line x1="0" x2={W} y1={yPx(p95)} y2={yPx(p95)} stroke="var(--color-ink-4)" vectorEffect="non-scaling-stroke" />
          ) : null}
          {n > 1 ? (
            <>
              <path d={area} fill="var(--color-ink)" fillOpacity="0.045" />
              <path
                d={line}
                fill="none"
                stroke="var(--color-ink)"
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            </>
          ) : null}
        </svg>

        {/* Labels in HTML so they don't stretch. */}
        {cap != null ? (
          <span
            aria-hidden="true"
            className="num absolute right-0 -translate-y-full pb-1 text-[11px] leading-none text-accent-ink"
            style={{ top: yPx(cap) }}
          >
            rules cap {pct(cap, 0)}
          </span>
        ) : null}
        {p95 != null ? (
          <span
            aria-hidden="true"
            className="num absolute left-0 pt-1 text-[11px] leading-none text-ink-3"
            style={{ top: yPx(p95) }}
          >
            p95 {pct(p95)}
          </span>
        ) : null}
        <span aria-hidden="true" className="num absolute bottom-0 left-0 translate-y-full pt-1.5 text-[11px] text-ink-3">
          first trade
        </span>
        <span aria-hidden="true" className="num absolute bottom-0 right-0 translate-y-full pt-1.5 text-[11px] text-ink-3">
          latest
        </span>

        {/* End dot, or the active trade's crosshair and dot. */}
        {a == null ? (
          <span
            aria-hidden="true"
            className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink ring-2 ring-surface"
            style={{ left: `${xPct(n - 1)}%`, top: yPx(points[n - 1].share) }}
          />
        ) : (
          <>
            <span
              aria-hidden="true"
              className="absolute inset-y-0 w-px -translate-x-1/2 bg-ink/25"
              style={{ left: `${xPct(active!)}%` }}
            />
            <span
              aria-hidden="true"
              className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink ring-2 ring-surface"
              style={{ left: `${xPct(active!)}%`, top: yPx(a.share) }}
            />
            <div
              id={tipId}
              role="status"
              className="pointer-events-none absolute top-0 z-10 w-max max-w-[14rem] rounded-field border border-line bg-surface px-3 py-2 shadow-lift"
              style={{
                left: `${xPct(active!)}%`,
                transform: `translateX(${xPct(active!) > 70 ? "calc(-100% - 10px)" : "10px"})`,
              }}
            >
              <div className="num text-[15px] leading-none text-ink">{pct(a.share)}</div>
              <div className="mt-1 text-[11.5px] text-ink-3">
                in stocks after trade <span className="num">{active! + 1}</span> of <span className="num">{n}</span>
                {a.market ? ` · ${a.market} market` : ""}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
