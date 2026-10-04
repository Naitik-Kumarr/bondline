"use client";

import { keccak256, stringToBytes } from "viem";
import { useEffect, useState } from "react";
import { CheckIcon, AlertIcon } from "@/components/ui/icons";
import { Pill } from "@/components/ui/Pill";

/** Re-hashes the letter's text in your browser (keccak256 of its UTF-8 bytes) and compares it with the stored hash. */
export function RehashCheck({ letter, hash }: { letter: string; hash: string }) {
  const [computed, setComputed] = useState<string | null>(null);
  useEffect(() => setComputed(keccak256(stringToBytes(letter))), [letter]);
  const ok = computed != null && computed.toLowerCase() === hash.toLowerCase();
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 text-[12.5px] text-ink-3">
      {computed == null ? (
        <Pill size="sm" tone="neutral">Checking the hash…</Pill>
      ) : ok ? (
        <Pill size="sm" tone="positive" icon={<CheckIcon size={12} />}>Hash matches the text</Pill>
      ) : (
        <Pill size="sm" tone="negative" icon={<AlertIcon size={12} />}>Hash does not match the text</Pill>
      )}
      <span>
        computed in your browser: <span className="num break-all text-ink-2">{computed ?? "…"}</span>
      </span>
    </div>
  );
}
