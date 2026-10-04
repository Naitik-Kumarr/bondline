"use client";

import * as m from "motion/react-m";
import type { ReactNode } from "react";

const tags = {
  div: m.div,
  section: m.section,
  article: m.article,
  li: m.li,
  ul: m.ul,
  p: m.p,
  span: m.span,
  h2: m.h2,
  figure: m.figure,
} as const;

export type RevealProps = {
  children?: ReactNode;
  className?: string;
  as?: keyof typeof tags;
  /** Seconds. Use small steps (0.06) to stagger siblings. */
  delay?: number;
  /** Starting offset in px. Transform only. */
  y?: number;
  /** How much of the element must be visible before it eases in (0 to 1). */
  amount?: number;
  id?: string;
};

/**
 * Eases content in as it scrolls into view: a calm spring on translateY plus an opacity fade.
 * Animates only transform and opacity. Under reduced motion it renders in place (see globals.css, [data-reveal]),
 * and MotionConfig reducedMotion="user" drops the movement.
 */
export function Reveal({ children, className, as = "div", delay = 0, y = 18, amount = 0.25, id }: RevealProps) {
  const Tag = tags[as];
  return (
    <Tag
      id={id}
      data-reveal=""
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount }}
      transition={{
        y: { type: "spring", stiffness: 120, damping: 22, mass: 1, delay },
        opacity: { duration: 0.7, ease: [0.22, 1, 0.36, 1], delay },
      }}
    >
      {children}
    </Tag>
  );
}
