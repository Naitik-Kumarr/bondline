"use client";

import type { Format } from "@number-flow/react";
import { clsx as cn } from "clsx";
import { useReducedMotion } from "motion/react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type CSSProperties,
  type ReactNode,
} from "react";
import { ReplayIcon } from "@/components/ui/icons";
import { formatBps, formatUsd, usdFormat } from "@/lib/format";
import { buildGeometry, CAP_BPS, pct, toPath, X, type GapDemo, type GapGeometry } from "./gap-geometry";

/**
 * The animated part of the gap replay (chart + numbers). See GapReplay.tsx for the card around it.
 * Motion: CSS keyframes on transform, opacity and stroke-dashoffset (SVG path drawing), started when this block is
 * 45% in view. Fixed aspect ratios, so no layout shift. Reduced motion (or no JS): the final frame, statically.
 * NumberFlow loads only when the replay starts, so it stays out of the page's first load.
 */

/** Timeline, in seconds. CSS animations read these through --d / --dur. */
const T = {
  friday: 0.15,
  fridayDur: 1.5,
  fridayClose: 1.6,
  ticks: 1.74,
  tickStep: 0.075,
  plunge: 2.48,
  plungeDur: 0.3,
  open: 2.76,
  monday: 2.78,
  mondayDur: 0.7,
  userArea: 2.95,
  bondArea: 3.15,
  userLabel: 3.35,
  bondLabel: 3.65,
  countLoss: 3.05,
  countPays: 3.4,
  replay: 4.6,
} as const;

const LAYOUTS = {
  wide: { w: 1040, h: 400, price: 2.4, limit: 1.6, dot: 4.2, tick: 2.4, dash: "7 6" },
  tall: { w: 340, h: 300, price: 2.1, limit: 1.4, dot: 3.8, tick: 1.9, dash: "5 4.5" },
} as const;

type Layout = (typeof LAYOUTS)[keyof typeof LAYOUTS];

const v = (vars: Record<string, string | number>) =>
  Object.fromEntries(Object.entries(vars).map(([k, val]) => [`--${k}`, typeof val === "number" ? `${val}s` : val])) as CSSProperties;

function ChartSvg({ geo, layout, className }: { geo: GapGeometry; layout: Layout; className?: string }) {
  const { w, h } = layout;
  const L = geo.levels;
  const id = `gr-${w}`;
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className={cn("absolute inset-0 h-full w-full overflow-visible", className)}
      aria-hidden="true"
    >
      <defs>
        <pattern id={`${id}-hatch`} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <path d="M0 0v7" stroke="#7c83ee" strokeOpacity="0.16" strokeWidth="1.4" />
        </pattern>
        <linearGradient id={`${id}-bond`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#fbd4bd" />
          <stop offset="1" stopColor="#f4ad86" />
        </linearGradient>
      </defs>

      {/* Market closed: the weekend band */}
      <rect x={X.bandStart * w} y={0} width={(X.bandEnd - X.bandStart) * w} height={h} fill="#f5f5fe" />
      <rect
        x={X.bandStart * w}
        y={0}
        width={(X.bandEnd - X.bandStart) * w}
        height={h}
        fill={`url(#${id}-hatch)`}
      />

      {/* Grid: start value, -20%, the 30% cap */}
      <path d={`M0 ${L.zero * h}H${w}`} stroke="#1f1f1f" strokeOpacity="0.1" strokeWidth="1" />
      <path d={`M0 ${geo.y(2000) * h}H${w}`} stroke="#1f1f1f" strokeOpacity="0.05" strokeWidth="1" />
      <path d={`M0 ${L.cap * h}H${w}`} stroke="#1f1f1f" strokeOpacity="0.14" strokeWidth="1" strokeDasharray="2 4" />

      {/* What the user loses (start to limit) and what the bond pays (limit to price) */}
      <path
        data-gr="pour"
        style={v({ d: T.userArea, dur: 0.6 })}
        d={toPath(geo.userArea, w, h, true)}
        fill="#1f1f1f"
        fillOpacity="0.045"
      />
      <path data-gr="pour" style={v({ d: T.bondArea, dur: 0.85 })} d={toPath(geo.bondArea, w, h, true)} fill={`url(#${id}-bond)`} />

      {/* Your limit */}
      <path
        d={`M0 ${L.limit * h}H${w}`}
        stroke="#7c83ee"
        strokeWidth={layout.limit}
        strokeDasharray={layout.dash}
        strokeLinecap="round"
      />

      {/* The price */}
      <g fill="none" stroke="#1f1f1f" strokeLinecap="round" strokeLinejoin="round">
        <path
          data-gr="draw"
          className="gr-draw"
          pathLength={1}
          style={v({ d: T.friday, dur: T.fridayDur, ease: "cubic-bezier(0.45, 0.05, 0.55, 0.95)" })}
          d={toPath(geo.friday, w, h)}
          strokeWidth={layout.price}
        />
        <path
          data-gr="draw"
          className="gr-draw"
          pathLength={1}
          style={v({ d: T.plunge, dur: T.plungeDur, ease: "cubic-bezier(0.55, 0, 0.75, 0.25)" })}
          d={toPath(geo.plunge, w, h)}
          strokeWidth={layout.price}
        />
        <path
          data-gr="draw"
          className="gr-draw"
          pathLength={1}
          style={v({ d: T.monday, dur: T.mondayDur, ease: "linear" })}
          d={toPath(geo.monday, w, h)}
          strokeWidth={layout.price}
        />
      </g>
      <g fill="#1f1f1f">
        {geo.weekend.map((p, i) => (
          <circle
            key={i}
            data-gr="tick"
            style={v({ d: T.ticks + i * T.tickStep })}
            cx={p.x * w}
            cy={p.y * h}
            r={layout.tick}
            fillOpacity={0.55}
          />
        ))}
      </g>

      {/* Friday close and Monday open */}
      <circle
        data-gr="pop"
        style={v({ d: T.fridayClose })}
        cx={X.bandStart * w}
        cy={L.friday * h}
        r={layout.dot}
        fill="#1f1f1f"
        stroke="#fff"
        strokeWidth="2"
      />
      <circle
        data-gr="pop"
        style={v({ d: T.open + 0.08 })}
        cx={geo.openX * w}
        cy={L.monday * h}
        r={layout.dot * 2.6}
        fill="#f2a37a"
        fillOpacity="0.28"
      />
      <circle
        data-gr="pop"
        style={v({ d: T.open })}
        cx={geo.openX * w}
        cy={L.monday * h}
        r={layout.dot}
        fill="#1f1f1f"
        stroke="#fff"
        strokeWidth="2"
      />
    </svg>
  );
}

/** An HTML label pinned to a chart point. `anchor` picks which corner of the label sits on the point. */
function ChartLabel({
  x,
  y,
  anchor,
  children,
  className,
  delay,
}: {
  x: number;
  y: number;
  anchor: "bl" | "tl" | "br" | "tr" | "c" | "bc" | "tc";
  children: ReactNode;
  className?: string;
  /** If set, the label fades in at this time; otherwise it's part of the stage from the start. */
  delay?: number;
}) {
  const shift = {
    bl: "translate(0, -100%)",
    tl: "translate(0, 0)",
    br: "translate(-100%, -100%)",
    tr: "translate(-100%, 0)",
    c: "translate(-50%, -50%)",
    bc: "translate(-50%, -100%)",
    tc: "translate(-50%, 0)",
  }[anchor];
  return (
    <span className="pointer-events-none absolute" style={{ left: pct(x), top: pct(y), transform: shift }}>
      <span
        className={cn("block whitespace-nowrap", className)}
        {...(delay !== undefined ? { "data-gr": "fade", style: v({ d: delay }) } : {})}
      >
        {children}
      </span>
    </span>
  );
}

const label = "font-mono text-[10px] leading-none tracking-[0.02em] sm:text-[11.5px]";
const numberTiming = { duration: 950, easing: "cubic-bezier(0.22, 1, 0.36, 1)" };

type NumberFlowComponent = ComponentType<{
  value: number;
  format?: Format;
  locales?: Intl.LocalesArgument;
  animated?: boolean;
  trend?: number;
  suffix?: string;
  transformTiming?: EffectTiming;
  spinTiming?: EffectTiming;
}>;

/**
 * How an amount reads: dollars (the hero), a USDG amount with cents (its unit is set beside it, smaller), a share of
 * the account, or a plain number.
 */
type AmountKind = "usd" | "usdg" | "share" | "plain";

const amountFormat = (kind: AmountKind, value: number): Intl.NumberFormatOptions =>
  kind === "usd"
    ? usdFormat(value)
    : kind === "usdg"
      ? { minimumFractionDigits: 2, maximumFractionDigits: 2 }
      : kind === "share"
        ? { style: "percent", maximumFractionDigits: 2 }
        : { maximumFractionDigits: 2 };

/** The amount as text, without the USDG unit. */
const amountText = (kind: AmountKind, value: number) =>
  kind === "usd" ? formatUsd(value) : new Intl.NumberFormat("en-US", amountFormat(kind, value)).format(value);

/** NumberFlow once it has loaded; the formatted text until then (same font, same size). */
function Amount({
  Flow,
  value,
  animated,
  kind = "usd",
}: {
  Flow: NumberFlowComponent | null;
  value: number;
  animated: boolean;
  kind?: AmountKind;
}) {
  if (!Flow) return <span>{amountText(kind, value)}</span>;
  return (
    <Flow
      value={value}
      format={amountFormat(kind, value) as Format}
      locales="en-US"
      animated={animated}
      trend={1}
      transformTiming={numberTiming}
      spinTiming={numberTiming}
    />
  );
}

/**
 * `units="usdg"` (the tour): "You lose" reads as a share of the account and "Bond pays" in USDG, as the Settled event
 * states them. The default reads both in dollars.
 */
export function GapReplayPlayer({ data: d, units = "usd" }: { data: GapDemo; units?: "usd" | "usdg" }) {
  const geo = useMemo(() => buildGeometry(d), [d]);
  const reduce = useReducedMotion();
  const root = useRef<HTMLDivElement>(null);

  const [play, setPlay] = useState<"idle" | "play">("idle");
  const [run, setRun] = useState(0);
  // Server render and reduced motion: the final numbers. With motion, they reset to zero and count up.
  const [values, setValues] = useState({ loss: d.userLossUsd, pays: d.bondPaysUsd });
  const [lit, setLit] = useState({ loss: true, pays: true });
  const [animateNumbers, setAnimateNumbers] = useState(false);
  const [Flow, setFlow] = useState<NumberFlowComponent | null>(null);

  useEffect(() => {
    if (reduce) return;
    setValues({ loss: 0, pays: 0 });
    setLit({ loss: false, pays: false });
    const el = root.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          setPlay("play");
        }
      },
      { threshold: 0.45 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [reduce]);

  // Load NumberFlow as the replay starts; the count-up begins about three seconds later.
  useEffect(() => {
    if (play !== "play" || Flow) return;
    let alive = true;
    import("@number-flow/react").then((mod) => {
      if (alive) setFlow(() => mod.default as unknown as NumberFlowComponent);
    });
    return () => {
      alive = false;
    };
  }, [play, Flow]);

  useEffect(() => {
    if (play !== "play") return;
    setAnimateNumbers(true);
    const timers = [
      window.setTimeout(() => {
        setValues((s) => ({ ...s, loss: d.userLossUsd }));
        setLit((s) => ({ ...s, loss: true }));
      }, T.countLoss * 1000),
      window.setTimeout(() => {
        setValues((s) => ({ ...s, pays: d.bondPaysUsd }));
        setLit((s) => ({ ...s, pays: true }));
      }, T.countPays * 1000),
    ];
    return () => timers.forEach(window.clearTimeout);
  }, [play, run, d.userLossUsd, d.bondPaysUsd]);

  const replay = () => {
    setAnimateNumbers(false);
    setValues({ loss: 0, pays: 0 });
    setLit({ loss: false, pays: false });
    setRun((r) => r + 1);
  };

  const L = geo.levels;
  const limitText = formatBps(d.limitBps);
  const usdg = units === "usdg";
  const lossKind: AmountKind = usdg ? "share" : "usd";
  const paysKind: AmountKind = usdg ? "usdg" : "usd";
  // "You lose" as a share counts up from 0 to the user's loss over the account.
  const lossShare = (usd: number) => (d.accountUsd > 0 ? usd / d.accountUsd : 0);
  // Long amounts (four digits with cents) step down a size so both fit side by side on a phone.
  const long = usdg
    ? amountText("usdg", d.bondPaysUsd).length > 7
    : Math.max(formatUsd(d.userLossUsd).length, formatUsd(d.bondPaysUsd).length) > 7;
  const amountSize = long ? "text-[24px] sm:text-[36px]" : "text-[30px] sm:text-[40px]";
  const summary = usdg
    ? `Replay of the claim: a ${amountText("plain", d.accountUsd)} USDG account with a ${limitText} loss limit is down ` +
      `${formatBps(d.fridayDrawdownBps)} at the scripted Friday close. No prices over the weekend. The scripted Monday ` +
      `open is down ${formatBps(d.mondayDrawdownBps)}, through the limit. You lose ${amountText("share", lossShare(d.userLossUsd))} ` +
      `(${amountText("usdg", d.userLossUsd)} USDG); the bond pays ${amountText("usdg", d.bondPaysUsd)} USDG.`
    : `${d.status === "real" ? "Replay of our scripted gap claim" : "Illustration"}: a ${formatUsd(d.accountUsd)} account ` +
      `with a ${limitText} loss limit is down ${formatBps(d.fridayDrawdownBps)} at Friday's close. ` +
      `The market is closed for the weekend. Monday it opens down ${formatBps(d.mondayDrawdownBps)}, through the limit. ` +
      `You lose ${formatUsd(d.userLossUsd)}; the bond pays ${formatUsd(d.bondPaysUsd)}.`;

  return (
    <div ref={root} data-play={play} className="gr relative">
      {/* The chart: fixed aspect ratios (tall on phones, wide from md), so nothing shifts */}
      <figure role="img" aria-label={summary} className="m-0">
        <div className="relative aspect-[340/300] w-full md:aspect-[1040/400]">
          <div key={run} className="absolute inset-0">
            <ChartSvg geo={geo} layout={LAYOUTS.tall} className="md:hidden" />
            <ChartSvg geo={geo} layout={LAYOUTS.wide} className="hidden md:block" />

            {/* Stage labels: there from the start */}
            <ChartLabel x={0} y={0.006} anchor="tl" className={cn(label, "text-ink-3")}>
              {usdg ? `${amountText("plain", d.accountUsd)} USDG` : formatUsd(d.accountUsd)}
              <span className="hidden md:inline"> account</span>
            </ChartLabel>
            <ChartLabel x={X.start} y={L.limit + 0.03} anchor="tl" className={cn(label, "font-medium text-accent-ink")}>
              Your limit {formatBps(d.limitBps, { negative: true })}
            </ChartLabel>
            <ChartLabel x={X.start} y={L.cap - 0.025} anchor="bl" className={cn(label, "text-ink-3")}>
              Cover cap {formatBps(CAP_BPS, { negative: true })}
            </ChartLabel>
            <ChartLabel
              x={(X.bandStart + X.bandEnd) / 2}
              y={0.035}
              anchor="tc"
              className={cn(label, "text-center uppercase tracking-[0.1em] text-accent-ink/80")}
            >
              Market
              <br />
              closed
            </ChartLabel>

            {/* Event labels: fade in on cue */}
            <ChartLabel
              x={X.bandStart + 0.012}
              y={L.friday - 0.04}
              anchor="bl"
              delay={T.fridayClose + 0.05}
              className={cn(label, "text-ink-2")}
            >
              <span className="hidden md:inline">Friday close </span>
              {formatBps(d.fridayDrawdownBps, { negative: true })}
            </ChartLabel>
            <ChartLabel
              x={geo.openX + 0.018}
              y={L.monday + 0.045}
              anchor="tl"
              delay={T.open + 0.15}
              className={cn(label, "font-medium text-ink")}
            >
              <span className="hidden md:inline">Monday open </span>
              <span className="md:hidden">Open </span>
              {formatBps(d.mondayDrawdownBps, { negative: true })}
            </ChartLabel>
            <ChartLabel
              x={(X.bandEnd + X.end) / 2 + 0.01}
              y={(L.zero + L.limit) / 2}
              anchor="c"
              delay={T.userLabel}
              className={cn(label, "text-ink-2")}
            >
              You lose
            </ChartLabel>
            <ChartLabel
              x={(X.bandEnd + X.end) / 2 + 0.01}
              y={(L.limit + Math.min(L.monday, L.cap)) / 2}
              anchor="c"
              delay={T.bondLabel}
              className={cn(label, "font-medium text-bond-ink")}
            >
              Bond pays
            </ChartLabel>
          </div>
        </div>

        {/* Day axis */}
        <div className="relative mt-2 h-4 font-mono text-[10px] text-ink-3 sm:text-[11px]" aria-hidden="true">
          <span className="absolute -translate-x-1/2" style={{ left: pct((X.start + X.bandStart) / 2) }}>
            Friday
          </span>
          <span className="absolute -translate-x-1/2" style={{ left: pct((X.bandStart + X.bandEnd) / 2) }}>
            Sat · Sun
          </span>
          <span className="absolute -translate-x-1/2" style={{ left: pct((X.bandEnd + X.end) / 2) }}>
            Monday
          </span>
        </div>
      </figure>

      {/* The numbers */}
      <div className="mt-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-4 border-t border-line pt-5 sm:mt-6 sm:pt-6">
        <div className="flex items-end gap-5 sm:gap-8">
          <div>
            <div className="text-[13px] text-ink-2">You lose</div>
            <div data-gr="num" className="mt-1">
              <div
                className={cn(
                  "num leading-none tracking-[-0.03em] text-ink transition-opacity duration-500",
                  amountSize,
                  !lit.loss && "opacity-35",
                )}
              >
              <Amount
                Flow={Flow}
                value={usdg ? lossShare(values.loss) : values.loss}
                animated={animateNumbers}
                kind={lossKind}
              />
              </div>
            </div>
            <div className="mt-1.5 text-[12px] text-ink-3">
              {usdg ? "your limit" : <>your {limitText} limit</>}
            </div>
          </div>
          <span aria-hidden="true" className="w-px self-stretch bg-line" />
          <div>
            <div className="text-[13px] font-medium text-bond-ink">Bond pays</div>
            <div data-gr="num" className="mt-1">
              <div
                className={cn(
                  "num leading-none tracking-[-0.03em] text-bond-ink transition-opacity duration-500",
                  amountSize,
                  !lit.pays && "opacity-35",
                )}
              >
              <Amount Flow={Flow} value={values.pays} animated={animateNumbers} kind={paysKind} />
              {usdg ? <span className="ml-1.5 text-[0.5em] tracking-normal">USDG</span> : null}
              </div>
            </div>
            <div className="mt-1.5 text-[12px] text-ink-3">the gap past your limit</div>
          </div>
        </div>
        <button
          key={run}
          type="button"
          onClick={replay}
          data-gr="fade"
          style={v({ d: T.replay })}
          className="inline-flex h-9 items-center gap-2 rounded-full bg-sunken px-4 text-[13px] text-ink-2 transition-colors hover:bg-sunken-2 hover:text-ink motion-reduce:hidden"
        >
          <ReplayIcon size={14} />
          Replay
        </button>
      </div>

    </div>
  );
}
