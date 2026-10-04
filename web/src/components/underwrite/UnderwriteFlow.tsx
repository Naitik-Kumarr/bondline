"use client";

import type { MarketKey } from "@bondline/shared/deployment";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { useState } from "react";
import { useAccount } from "wagmi";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Container } from "@/components/ui/Container";
import { ArrowRightIcon, CheckIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import { AGENTS, MARKETS, type PersonaKey } from "@/components/account/kit/bondline";
import { useWalletFunds } from "@/components/account/kit/useWalletFunds";
import { AgentChoice } from "./AgentChoice";
import { OfferLive } from "./OfferLive";
import type { PriceTables } from "./price-lookup";
import { SignStep, type LiveOfferResult } from "./SignStep";
import { draftFor, validateTerms, type TermsDraft } from "./terms";
import { TermsStep } from "./TermsStep";

const STEPS = ["Choose an agent", "Set terms", "Sign once"] as const;

function Stepper({ step, reachable, onStep }: { step: number; reachable: number; onStep: (n: number) => void }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-2" aria-label="Steps">
      {STEPS.map((label, i) => {
        const n = i + 1;
        const done = n < step;
        const current = n === step;
        return (
          <li key={label} className="flex items-center gap-2">
            <button
              type="button"
              disabled={n > reachable || current}
              onClick={() => onStep(n)}
              aria-current={current ? "step" : undefined}
              className={cn(
                "inline-flex h-9 items-center gap-2 rounded-full pr-3.5 pl-1.5 text-[14px] transition-colors",
                current ? "bg-ink text-white" : done ? "bg-surface text-ink shadow-hairline hover:bg-sunken" : "text-ink-3",
              )}
            >
              <span
                className={cn(
                  "num inline-flex size-6 items-center justify-center rounded-full text-[12px]",
                  current ? "bg-white/15" : done ? "bg-positive-soft text-positive" : "bg-sunken",
                )}
              >
                {done ? <CheckIcon size={13} strokeWidth={2.2} /> : n}
              </span>
              <span className={cn(!current && "hidden sm:inline")}>{label}</span>
            </button>
            {n < STEPS.length ? <span aria-hidden="true" className="h-px w-5 bg-line-strong sm:w-8" /> : null}
          </li>
        );
      })}
    </ol>
  );
}

/** Choose an agent, set terms, sign once: a calm three-step flow that ends in "your offer is live". */
export function UnderwriteFlow({ prices }: { prices: PriceTables }) {
  const { address, isConnected } = useAccount();
  const funds = useWalletFunds(address);
  const [step, setStep] = useState(1);
  const [agentKey, setAgentKey] = useState<PersonaKey | null>(null);
  const [market, setMarket] = useState<MarketKey>(MARKETS[0]?.key ?? "replay");
  const [drafts, setDrafts] = useState<Partial<Record<PersonaKey, TermsDraft>>>({});
  const [live, setLive] = useState<LiveOfferResult | null>(null);

  const agent = AGENTS.find((a) => a.key === agentKey);
  const marketInfo = MARKETS.find((x) => x.key === market)!;
  const draft = agent ? (drafts[agent.key] ?? draftFor(agent)) : null;
  const valid = agent && draft ? validateTerms(draft, agent).valid : null;
  const reachable = !agent ? 1 : !valid ? 2 : 3;

  const reset = () => {
    setLive(null);
    setStep(1);
  };

  return (
    <Container className="mt-10 sm:mt-14">
      <Card padding="md" className="overflow-hidden sm:p-10">
        {live ? (
          <OfferLive result={live} onAnother={reset} />
        ) : (
          <>
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
              <Stepper step={step} reachable={reachable} onStep={setStep} />
              <p className="text-[13px] text-ink-3">One signature, one transaction. No approve step.</p>
            </div>
            <div className="mt-8 border-t border-line pt-8">
              <AnimatePresence mode="wait" initial={false}>
                <m.div
                  key={step}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                >
                  {step === 1 ? (
                    <AgentChoice
                      prices={prices}
                      agent={agentKey}
                      market={market}
                      onAgent={setAgentKey}
                      onMarket={setMarket}
                    />
                  ) : step === 2 && agent && draft ? (
                    <TermsStep
                      agent={agent}
                      table={prices.agents[agent.key]}
                      draft={draft}
                      onChange={(d) => setDrafts((all) => ({ ...all, [agent.key]: d }))}
                      balance={funds.usdg}
                      connected={isConnected}
                    />
                  ) : step === 3 && agent && valid ? (
                    <SignStep agent={agent} market={marketInfo} valid={valid} onLive={setLive} />
                  ) : null}
                </m.div>
              </AnimatePresence>
            </div>
            <div className="mt-10 flex items-center justify-between gap-3 border-t border-line pt-6">
              {step > 1 ? (
                <Button variant="ghost" onClick={() => setStep(step - 1)}>
                  Back
                </Button>
              ) : (
                <span />
              )}
              {step < 3 ? (
                <Button
                  disabled={reachable <= step}
                  onClick={() => setStep(step + 1)}
                  iconRight={<ArrowRightIcon size={15} />}
                >
                  {step === 1 ? (agent ? `Set terms for ${agent.name}` : "Choose an agent") : "Review and sign"}
                </Button>
              ) : null}
            </div>
          </>
        )}
      </Card>
    </Container>
  );
}
