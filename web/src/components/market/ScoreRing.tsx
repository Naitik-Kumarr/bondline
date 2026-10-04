import { cn } from "@/lib/cn";

/**
 * The 0–100 display score as a ring: a hairline track and a periwinkle arc from twelve o'clock. Static (no stroke
 * animation): it eases in with its card. No record: an empty ring and a dash.
 */
export function ScoreRing({
  value,
  size = 64,
  stroke = 5,
  className,
}: {
  value: number | null;
  size?: number;
  stroke?: number;
  className?: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = value == null ? 0 : Math.max(0, Math.min(100, value));
  const big = size >= 88;
  return (
    <div
      role="img"
      aria-label={value == null ? "No score: no record yet" : `Score ${value} out of 100`}
      className={cn("relative shrink-0", className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-sunken-2)" strokeWidth={stroke} />
        {value != null && v > 0 ? (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="var(--color-accent)"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${(c * v) / 100} ${c}`}
          />
        ) : null}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center" aria-hidden="true">
        <span className={cn("num leading-none tracking-[-0.03em] text-ink", big ? "text-[30px]" : "text-[19px]")}>
          {value ?? "n/a"}
        </span>
        <span className={cn("mt-1 font-mono uppercase tracking-[0.1em] text-ink-3", big ? "text-[10px]" : "text-[8.5px]")}>
          {value == null ? "no record" : "score"}
        </span>
      </div>
    </div>
  );
}
