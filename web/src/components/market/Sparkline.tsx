import { cn } from "@/lib/cn";
import { pct } from "./fmt";

/**
 * The record at a glance: the share of the account in stocks after each trade (2px ink line, a faint wash), against
 * the rules' cap (dashed periwinkle, the same threshold language as the hero's limit line). Server-rendered SVG;
 * labels and the end dot are HTML so they don't stretch with the plot.
 */
export function Sparkline({
  points,
  cap,
  height = 56,
  className,
  emptyText = "No trades yet",
}: {
  /** Shares from 0 to 1, oldest first. */
  points: number[];
  /** The rules' maximum stock share, 0 to 1. */
  cap: number | null;
  height?: number;
  className?: string;
  emptyText?: string;
}) {
  if (points.length === 0) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-field border border-dashed border-line-strong text-[12.5px] text-ink-3",
          className,
        )}
        style={{ height }}
      >
        {emptyText}
      </div>
    );
  }

  const W = 300;
  const H = height;
  const pad = 6;
  const top = Math.max(cap ?? 0, ...points, 0.05) * 1.15;
  const x = (i: number) => (points.length === 1 ? W : (i / (points.length - 1)) * W);
  const y = (v: number) => pad + (1 - v / top) * (H - 2 * pad);
  const line = points.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(2)} ${y(v).toFixed(2)}`).join("");
  const area = `${line}L${W} ${H}L0 ${H}Z`;
  const last = points[points.length - 1];
  const capY = cap != null ? y(cap) : null;
  const summary =
    `Stock share after each of ${points.length} trade${points.length === 1 ? "" : "s"}: ` +
    `first ${pct(points[0])}, latest ${pct(last)}, highest ${pct(Math.max(...points))}` +
    (cap != null ? `; the rules cap it at ${pct(cap, 0)}.` : ".");

  return (
    <div role="img" aria-label={summary} className={cn("relative", className)} style={{ height }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full overflow-visible"
        aria-hidden="true"
      >
        <line x1="0" x2={W} y1={H - 0.5} y2={H - 0.5} stroke="var(--color-line)" vectorEffect="non-scaling-stroke" />
        {capY != null ? (
          <line
            x1="0"
            x2={W}
            y1={capY}
            y2={capY}
            stroke="var(--color-accent)"
            strokeWidth="1.25"
            strokeDasharray="4 4"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
        {points.length > 1 ? (
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
      {capY != null ? (
        <span
          aria-hidden="true"
          className="num absolute right-0 -translate-y-full pb-0.5 text-[10.5px] leading-none text-accent-ink"
          style={{ top: `${(capY / H) * 100}%` }}
        >
          cap {pct(cap!, 0)}
        </span>
      ) : null}
      <span
        aria-hidden="true"
        className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink ring-2 ring-surface"
        style={{ left: "100%", top: `${(y(last) / H) * 100}%` }}
      />
    </div>
  );
}
