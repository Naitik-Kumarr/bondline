import type { ComponentProps, ElementType, ReactNode } from "react";
import { cn } from "@/lib/cn";

type CardTone = "surface" | "sunken" | "bond" | "accent";
type CardPadding = "none" | "sm" | "md" | "lg";

const tones: Record<CardTone, string> = {
  surface: "bg-surface border-line shadow-soft",
  sunken: "bg-sunken border-line",
  bond: "bg-bond-tint border-[rgb(156_74_34/0.12)]",
  accent: "bg-accent-tint border-[rgb(74_80_194/0.12)]",
};

const paddings: Record<CardPadding, string> = {
  none: "",
  sm: "p-4 sm:p-5",
  md: "p-5 sm:p-7",
  lg: "p-6 sm:p-10",
};

export type CardProps<T extends ElementType = "div"> = {
  as?: T;
  tone?: CardTone;
  padding?: CardPadding;
  /** Lifts on hover with a soft spring (transform + shadow opacity). Use for clickable cards. */
  interactive?: boolean;
  /** 20px radius instead of 24px, for small cards and dense grids. */
  compact?: boolean;
  className?: string;
  children?: ReactNode;
} & Omit<ComponentProps<T>, "as" | "className" | "children">;

/** White card with a hairline border and a 24px radius. */
export function Card<T extends ElementType = "div">({
  as,
  tone = "surface",
  padding = "md",
  interactive = false,
  compact = false,
  className,
  children,
  ...rest
}: CardProps<T>) {
  const Tag = (as ?? "div") as ElementType;
  return (
    <Tag
      className={cn(
        "relative min-w-0 border",
        compact ? "rounded-card" : "rounded-card-lg",
        tones[tone],
        paddings[padding],
        interactive && "lift",
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/** Optional header row: title on the left, actions on the right. */
export function CardHeader({
  title,
  eyebrow,
  action,
  className,
}: {
  title?: ReactNode;
  eyebrow?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-5 flex items-start justify-between gap-4", className)}>
      <div className="min-w-0">
        {eyebrow ? <div className="eyebrow mb-1.5">{eyebrow}</div> : null}
        {title ? <h3 className="text-[17px] font-medium tracking-[-0.01em] text-ink">{title}</h3> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
