"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { Button } from "@/components/ui/Button";
import { DemoLabel } from "@/components/ui/Pill";
import { ArrowUpRightIcon } from "@/components/ui/icons";

type DripState = { status: "idle" | "sending" | "done" | "error"; message?: string; url?: string };

/**
 * The judge drip: 5 test USDG from a team-operated wallet, once per wallet, while today's budget lasts. /api/drip
 * checks the limits; this is only the button.
 */
export function JudgeDrip() {
  const { address } = useAccount();
  const [state, setState] = useState<DripState>({ status: "idle" });
  if (!address) return null;

  const ask = async () => {
    setState({ status: "sending" });
    try {
      const res = await fetch("/api/drip", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address }),
      });
      const body = (await res.json()) as { ok: boolean; error?: string; url?: string };
      setState(body.ok ? { status: "done", url: body.url } : { status: "error", message: body.error });
    } catch {
      setState({ status: "error", message: "Couldn't reach the drip just now. Try again in a minute." });
    }
  };

  return (
    <div className="mt-2.5 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          loading={state.status === "sending"}
          loadingLabel="Sending 5 USDG"
          disabled={state.status === "done"}
          onClick={ask}
        >
          {state.status === "done" ? "5 USDG sent" : "Get 5 test USDG"}
        </Button>
        <DemoLabel kind="team" title="From a team operated wallet, once per wallet, while today's budget lasts">
          Judge drip
        </DemoLabel>
      </div>
      <p className="text-[12px] leading-relaxed text-ink-3">
        From a team operated wallet: once per wallet, while today&apos;s budget lasts. Your balance updates within about
        20 seconds.
      </p>
      {state.status === "done" && state.url ? (
        <a href={state.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[12.5px] text-accent-ink underline underline-offset-4">
          See the transaction <ArrowUpRightIcon size={12} />
        </a>
      ) : null}
      {state.status === "error" ? <p className="text-[12.5px] text-negative">{state.message}</p> : null}
    </div>
  );
}
