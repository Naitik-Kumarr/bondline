import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

export type PillTone = "neutral" | "ink" | "accent" | "bond" | "positive" | "negative" | "caution";

const tones: Record<PillTone, { pill: string; dot: string }> = {
  neutral: { pill: "bg-surface text-ink-2 shadow-hairline", dot: "bg-ink-3" },
  ink: { pill: "bg-ink text-white", dot: "bg-white" },
  accent: { pill: "bg-accent-soft text-accent-ink", dot: "bg-accent" },
  bond: { pill: "bg-bond-soft text-bond-ink", dot: "bg-bond-strong" },
  positive: { pill: "bg-positive-soft text-positive", dot: "bg-positive" },
  negative: { pill: "bg-negative-soft text-negative", dot: "bg-negative" },
  caution: { pill: "bg-caution-soft text-caution", dot: "bg-caution" },
};

export type PillProps = ComponentProps<"span"> & {
  tone?: PillTone;
  size?: "sm" | "md";
  /** A small status dot before the label. */
  dot?: boolean;
  icon?: ReactNode;
  /** Numbers inside (e.g. "+12%") use mono tabular figures. */
  mono?: boolean;
};

/** Small rounded label. Also exported as `Badge`. */
export function Pill({ tone = "neutral", size = "md", dot, icon, mono, className, children, ...rest }: PillProps) {
  const t = tones[tone];
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-full font-medium",
        size === "sm" ? "h-6 px-2.5 text-[11.5px]" : "h-7 px-3 text-[12.5px]",
        mono && "num",
        t.pill,
        className,
      )}
      {...rest}
    >
      {dot ? <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", t.dot)} /> : null}
      {icon}
      {children}
    </span>
  );
}

export const Badge = Pill;

/** Honesty labels. Everything scripted, team-operated or illustrative carries one of these. */
export type DemoKind = "demo" | "scripted" | "team" | "illustration" | "replay" | "model" | "testnet";

const DEMO_TEXT: Record<DemoKind, string> = {
  demo: "Demo",
  scripted: "Scripted",
  team: "Team-operated",
  illustration: "Illustration",
  replay: "Replay market",
  model: "Model price",
  testnet: "Testnet",
};

/**
 * A dashed, mono label that reads as a caveat, not a feature: "Demo", "Scripted", "Team-operated"...
 * Pass children to override the text; `title` is shown on hover for the longer explanation.
 */
export function DemoLabel({
  kind = "demo",
  children,
  className,
  ...rest
}: ComponentProps<"span"> & { kind?: DemoKind }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 max-w-full items-center gap-1.5 whitespace-nowrap rounded-full border border-dashed border-ink/25 bg-page/80 px-2.5",
        "font-mono text-[10.5px] uppercase leading-none tracking-[0.1em] text-ink-2",
        className,
      )}
      {...rest}
    >
      <svg aria-hidden="true" width="8" height="8" viewBox="0 0 8 8" className="shrink-0 text-ink-3">
        <path d="M0 8 8 0M-2 4 4-2M4 10l6-6" stroke="currentColor" strokeWidth="1.2" />
      </svg>
      {children ?? DEMO_TEXT[kind]}
    </span>
  );
}
