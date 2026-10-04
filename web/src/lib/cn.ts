import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/** tailwind-merge needs to know our custom scales, or it would treat `text-display-xl` and `text-ink` as clashing colors. */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["display-xl", "display-l", "display-m", "display-s"],
      color: [
        "page",
        "surface",
        "sunken",
        "sunken-2",
        "ink",
        "ink-2",
        "ink-3",
        "ink-4",
        "line",
        "line-strong",
        "accent",
        "accent-ink",
        "accent-soft",
        "accent-tint",
        "bond",
        "bond-strong",
        "bond-ink",
        "bond-soft",
        "bond-tint",
        "positive",
        "positive-soft",
        "negative",
        "negative-soft",
        "caution",
        "caution-soft",
      ],
      radius: ["field", "card", "card-lg"],
      shadow: ["hairline", "soft", "lift", "pill"],
      ease: ["out-soft", "in-soft", "spring"],
    },
  },
});

/** Join class names; later Tailwind utilities win over earlier ones (so `className` props can override). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
