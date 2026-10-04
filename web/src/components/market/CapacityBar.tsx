"use client";

import * as m from "motion/react-m";
import { cn } from "@/lib/cn";

/**
 * Free bond as a share of the bond: a peach fill on a lighter peach track that fills as it scrolls into view.
 * The wrapper sets the width (layout, static); the fill only scales from 0 to 1 (transform). Under reduced motion
 * and without JavaScript, [data-reveal] pins it at its final width (see globals.css).
 */
export function CapacityBar({ share, label, className }: { share: number; label: string; className?: string }) {
  const w = Math.max(0, Math.min(1, Number.isFinite(share) ? share : 0));
  return (
    <div
      role="img"
      aria-label={label}
      className={cn("relative h-2 overflow-hidden rounded-full bg-bond-soft", className)}
    >
      <div className="h-full" style={{ width: `${(w * 100).toFixed(2)}%` }}>
        <m.div
          data-reveal=""
          className="h-full origin-left rounded-full bg-bond"
          initial={{ scaleX: 0 }}
          whileInView={{ scaleX: 1 }}
          viewport={{ once: true, amount: 0.9 }}
          transition={{ type: "spring", stiffness: 70, damping: 20, mass: 1, delay: 0.08 }}
        />
      </div>
    </div>
  );
}
