import { Fragment } from "react";

// Amounts, percentages, durations and counts inside a sentence: "$556.83", "86.8%", "412s", "1,234".
const NUMERIC = /(\$?\d[\d,]*(?:\.\d+)?(?:%|s\b|m\b|h\b)?)/g;

/** Renders a sentence with every number in Geist Mono (tabular), the rest in the surrounding font. */
export function NumText({ text, className }: { text: string; className?: string }) {
  const parts = text.split(NUMERIC);
  return (
    <span className={className}>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <span key={i} className="num">
            {p}
          </span>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </span>
  );
}
