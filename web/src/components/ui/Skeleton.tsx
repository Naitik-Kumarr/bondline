import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

/**
 * Placeholder for chain reads: never a blank screen. Give it the size of what it stands in for,
 * so nothing shifts when the data arrives. The shimmer is a transform-only highlight; static under reduced motion.
 */
export function Skeleton({
  className,
  rounded = "md",
  ...rest
}: ComponentProps<"span"> & { rounded?: "sm" | "md" | "lg" | "full" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative block overflow-hidden bg-sunken-2/70",
        rounded === "sm" && "rounded-[6px]",
        rounded === "md" && "rounded-[10px]",
        rounded === "lg" && "rounded-card",
        rounded === "full" && "rounded-full",
        className,
      )}
      {...rest}
    >
      <span
        className="motion-safe-shimmer absolute inset-0 bg-gradient-to-r from-transparent via-white/70 to-transparent"
        style={{ animation: "shimmer 1.6s cubic-bezier(0.4, 0, 0.2, 1) infinite" }}
      />
    </span>
  );
}

/** A few lines of text-shaped skeletons. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <span className={cn("flex flex-col gap-2", className)} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn("h-3.5", i === lines - 1 ? "w-2/3" : "w-full")} rounded="sm" />
      ))}
    </span>
  );
}
