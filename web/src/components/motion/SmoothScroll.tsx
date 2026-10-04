"use client";

import { useReducedMotion } from "motion/react";
import { useEffect } from "react";

/**
 * Lenis smooth scrolling for wheel and trackpad. Loaded after hydration, so it never delays the first paint.
 * Off entirely when the visitor prefers reduced motion; touch keeps native scrolling.
 */
export function SmoothScroll() {
  const reduce = useReducedMotion();

  useEffect(() => {
    if (reduce) return;
    let lenis: { destroy: () => void } | undefined;
    let cancelled = false;
    import("lenis").then(({ default: Lenis }) => {
      if (cancelled) return;
      lenis = new Lenis({
        autoRaf: true,
        anchors: true,
        lerp: 0.12,
        // Let modals (RainbowKit) and marked regions scroll natively.
        prevent: (node) => Boolean(node.closest?.("[data-rk], [data-lenis-prevent]")),
      });
    });
    return () => {
      cancelled = true;
      lenis?.destroy();
    };
  }, [reduce]);

  return null;
}
