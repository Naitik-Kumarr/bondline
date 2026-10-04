"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { CheckIcon, CopyIcon } from "./icons";

/** Small icon button that copies text and confirms with a check for 1.5s. */
export function CopyButton({ value, label = "Copy", className }: { value: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(value).then(() => setCopied(true), () => undefined);
      }}
      aria-label={copied ? "Copied" : label}
      title={copied ? "Copied" : label}
      className={cn(
        "inline-flex size-6 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-ink/5 hover:text-ink",
        className,
      )}
    >
      {copied ? <CheckIcon size={13} className="text-positive" /> : <CopyIcon size={13} />}
    </button>
  );
}
