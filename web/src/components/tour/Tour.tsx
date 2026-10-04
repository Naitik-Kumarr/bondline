"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useReducer, useRef, type ReactNode, type TouchEvent } from "react";
import { Wordmark } from "@/components/site/Wordmark";
import { Button, buttonClasses } from "@/components/ui/Button";
import { ArrowRightIcon, ArrowUpRightIcon, CloseIcon, ReplayIcon } from "@/components/ui/icons";
import { DemoLabel } from "@/components/ui/Pill";
import { cn } from "@/lib/cn";

export interface TourStep {
  id: string;
  /** A short name, for the progress bar and the screen-reader announcement. */
  label: string;
  /** At most 8 words. */
  headline: string;
  /** One sentence, at most 25 words. */
  sentence: string;
  visual: ReactNode;
  /** The step's one "See it on-chain" link, and what it opens. */
  chain: { href: string; hint: string } | null;
}

type State = { index: number; dir: "next" | "prev" | null };

/** Moves to `to` (clamped). `animate: false` jumps without a transition (a deep link on load). */
function reducer(s: State, a: { to: number; count: number; animate?: boolean }): State {
  const index = Math.max(0, Math.min(a.count - 1, a.to));
  if (index === s.index) return s;
  return { index, dir: a.animate === false ? null : index > s.index ? "next" : "prev" };
}

const SWIPE_PX = 56;

/**
 * The guided tour: one step at a time, with a progress bar, Back and Next, the arrow keys and swipe. The step is kept
 * in the URL hash (#step-3) so a link or a reload lands on it. Every step's content is rendered on the server and
 * arrives with the page, so moving between steps never waits on the network. A step eases in from the side it came
 * from (transform and opacity, see globals.css); with reduced motion it just appears.
 */
export function Tour({ steps }: { steps: TourStep[] }) {
  const count = steps.length;
  const [{ index, dir }, dispatch] = useReducer(reducer, { index: 0, dir: null });
  const go = (to: number) => dispatch({ to, count });
  const step = steps[index];
  const last = index === count - 1;
  const ready = useRef(false);
  const touch = useRef<{ x: number; y: number; t: number } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  // Deep link: #step-3 (or #3) opens that step, without a transition, on load and whenever the hash is changed by hand.
  // A layout effect, so coming back to the tour (browser Back from /judge) never paints step 1 first.
  useLayoutEffect(() => {
    const fromHash = () => {
      const m = window.location.hash.match(/^#(?:step-)?(\d+)$/);
      if (m) dispatch({ to: Number(m[1]) - 1, count, animate: false });
    };
    fromHash();
    ready.current = true;
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [count]);

  // Keep the hash in step with the tour (replace, so Back leaves the tour rather than stepping through it).
  useEffect(() => {
    if (!ready.current) return;
    const hash = `#step-${index + 1}`;
    if (window.location.hash !== hash && !(index === 0 && !window.location.hash)) {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${hash}`);
    }
  }, [index]);

  // A new step starts at the top. If the focused control went away with the old step (a link inside it, or Back as it
  // reached step 1), focus moves to the new headline rather than falling to the page.
  useEffect(() => {
    if (dir === null) return;
    if (window.scrollY > 0) window.scrollTo({ top: 0, behavior: "instant" });
    const active = document.activeElement;
    if (!active || active === document.body) heading.current?.focus({ preventScroll: true });
  }, [index, dir]);

  // Arrow keys, one step per press, unless someone is typing or holding a modifier.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        dispatch({ to: index + 1, count });
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        dispatch({ to: index - 1, count });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, count]);

  // Swipe: a mostly horizontal flick of at least 56px.
  const onTouchStart = (e: TouchEvent) => {
    if (e.touches.length !== 1) return void (touch.current = null);
    const p = e.touches[0];
    touch.current = { x: p.clientX, y: p.clientY, t: e.timeStamp };
  };
  const onTouchEnd = (e: TouchEvent) => {
    const s = touch.current;
    touch.current = null;
    if (!s) return;
    const p = e.changedTouches[0];
    const dx = p.clientX - s.x;
    const dy = p.clientY - s.y;
    if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < Math.abs(dy) * 1.5 || e.timeStamp - s.t > 800) return;
    go(index + (dx < 0 ? 1 : -1));
  };

  return (
    <>
      {/* One row from sm up; on phones the progress bar wraps to a second row inside the same card. */}
      <header className="relative z-40 px-3 pt-3 sm:sticky sm:top-0 sm:px-5 sm:pt-4 [@media(max-height:500px)]:static">
        <div className="mx-auto flex max-w-[72rem] flex-wrap items-center gap-x-3 rounded-[1.75rem] border border-line bg-surface/95 pb-1 pl-4 pr-2 pt-2 shadow-soft sm:h-14 sm:flex-nowrap sm:rounded-full sm:py-0 sm:pl-5">
          <div className="flex min-w-0 items-center gap-2.5">
            <Wordmark />
            <DemoLabel kind="testnet" title="Robinhood Chain testnet. Testnet, unaudited." className="h-5 px-2 text-[9.5px]" />
          </div>
          <ol aria-label="Tour progress" className="order-last flex w-full gap-1.5 pr-2 sm:order-none sm:mx-3 sm:w-auto sm:flex-1 sm:pr-0 lg:mx-8">
            {steps.map((s, i) => (
              <li key={s.id} className="flex-1">
                <button
                  type="button"
                  onClick={() => go(i)}
                  aria-label={`Step ${i + 1} of ${count}: ${s.label}`}
                  aria-current={i === index ? "step" : undefined}
                  className="group block w-full py-2.5"
                >
                  <span className="block h-1 overflow-hidden rounded-full bg-ink/10 group-hover:bg-ink/15">
                    <span
                      className={cn(
                        "block h-full origin-left rounded-full bg-accent transition-transform duration-500 ease-out-soft motion-reduce:transition-none",
                        i <= index ? "scale-x-100" : "scale-x-0",
                      )}
                    />
                  </span>
                </button>
              </li>
            ))}
          </ol>
          <div className="ml-auto flex items-center gap-1 sm:ml-0">
            <p className="num px-1.5 text-[12.5px] text-ink-3" aria-hidden="true">
              {index + 1} / {count}
            </p>
            <Link
              href="/"
              aria-label="Leave the tour"
              className="inline-flex size-11 items-center justify-center rounded-full text-ink-2 hover:bg-sunken hover:text-ink"
            >
              <CloseIcon size={18} />
            </Link>
          </div>
        </div>
      </header>

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        Step {index + 1} of {count}: {step.headline}
      </p>

      {/* overflow-x-clip: a step sliding in from the side must not widen the page (phones zoom out to fit it). */}
      <main id="main" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} className="min-h-[70dvh] overflow-x-clip">
        <div
          key={index}
          data-dir={dir ?? undefined}
          className="tour-step mx-auto grid w-full max-w-[72rem] grid-cols-1 gap-7 px-5 pb-36 pt-6 sm:px-8 sm:pt-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:grid-rows-[auto_1fr] lg:gap-x-14 lg:gap-y-8 lg:pb-32 lg:pt-14"
        >
          <div className="lg:col-start-1 lg:row-start-1">
            <p className="eyebrow">
              Step {index + 1} of {count} · {step.label}
            </p>
            <h1 ref={heading} tabIndex={-1} className="mt-4 max-w-[16ch] font-display text-display-l text-ink focus:outline-none">
              {step.headline}
            </h1>
            <p className="mt-5 max-w-[34rem] text-[17px] leading-relaxed text-ink-2 sm:text-[19px]">{step.sentence}</p>
          </div>

          <div className="min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1">{step.visual}</div>

          <div className="lg:col-start-1 lg:row-start-2">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
              {step.chain ? (
                <a
                  href={step.chain.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={buttonClasses({ variant: "secondary", size: "md" })}
                >
                  See it on-chain
                  <ArrowUpRightIcon size={14} className="opacity-60" />
                </a>
              ) : null}
              <Link
                href="/judge"
                className="group inline-flex items-center gap-1 text-[13.5px] text-ink-3 hover:text-ink"
              >
                Full judge kit
                <ArrowRightIcon
                  size={13}
                  className="transition-transform duration-[var(--duration-spring)] ease-spring group-hover:translate-x-0.5 motion-reduce:transition-none"
                />
              </Link>
            </div>
            {step.chain ? <p className="mt-2.5 text-[12.5px] text-ink-3">{step.chain.hint}</p> : null}
          </div>
        </div>
      </main>

      <nav aria-label="Tour" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-page/95 pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex max-w-[72rem] items-center gap-3 px-5 py-3 sm:px-8">
          <Button
            variant="secondary"
            size="lg"
            onClick={() => go(index - 1)}
            aria-disabled={index === 0 || undefined}
            icon={<ArrowRightIcon size={16} className="rotate-180" />}
            className="flex-1 sm:flex-none"
          >
            Back
          </Button>
          <p className="hidden flex-1 text-center text-[12.5px] text-ink-3 md:block">
            <kbd className="num rounded-md bg-sunken px-1.5 py-0.5 text-[11.5px] text-ink-2">←</kbd>{" "}
            <kbd className="num rounded-md bg-sunken px-1.5 py-0.5 text-[11.5px] text-ink-2">→</kbd> to move
          </p>
          {last ? (
            <Button
              variant="secondary"
              size="lg"
              onClick={() => go(0)}
              icon={<ReplayIcon size={16} />}
              className="flex-1 sm:ml-auto sm:flex-none md:ml-0"
            >
              Start over
            </Button>
          ) : (
            <Button
              size="lg"
              onClick={() => go(index + 1)}
              iconRight={<ArrowRightIcon size={16} />}
              className="flex-1 sm:ml-auto sm:flex-none md:ml-0"
            >
              Next
            </Button>
          )}
        </div>
      </nav>
    </>
  );
}
