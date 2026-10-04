"use client";

import { useId, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Label, the control, then a hint or an error. */
export function Field({
  label,
  hint,
  error,
  aside,
  htmlFor,
  className,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** Right of the label: a balance, a Max button. */
  aside?: ReactNode;
  htmlFor?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <label htmlFor={htmlFor} className="text-[14px] font-medium text-ink">
          {label}
        </label>
        {aside ? <div className="shrink-0 text-[12.5px] text-ink-3">{aside}</div> : null}
      </div>
      {children}
      {error ? (
        <p role="alert" className="mt-2 text-[13px] leading-snug text-negative">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-2 text-[12.5px] leading-snug text-ink-3">{hint}</p>
      ) : null}
    </div>
  );
}

const shell =
  "flex h-12 w-full min-w-0 items-center gap-2 rounded-field bg-surface px-4 shadow-hairline transition-shadow " +
  "focus-within:shadow-[0_0_0_1px_var(--color-accent),0_0_0_4px_var(--color-accent-soft)]";

/** A number in mono with a unit after it ("USDG", "%"). Keeps the raw text so typing "1." works. */
export function NumberInput({
  id,
  value,
  onChange,
  unit,
  placeholder,
  invalid,
  disabled,
  decimals = 6,
  className,
  ariaLabel,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  unit?: ReactNode;
  placeholder?: string;
  invalid?: boolean;
  disabled?: boolean;
  /** Most digits after the point. */
  decimals?: number;
  className?: string;
  ariaLabel?: string;
}) {
  const auto = useId();
  return (
    <div
      className={cn(
        shell,
        invalid && "shadow-[0_0_0_1px_rgb(177_63_57/0.55)]",
        disabled && "bg-sunken text-ink-3",
        className,
      )}
    >
      <input
        id={id ?? auto}
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        disabled={disabled}
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          const v = e.target.value.replace(/,/g, "").trim();
          const pattern = decimals > 0 ? new RegExp(`^\\d*(\\.\\d{0,${decimals}})?$`) : /^\d*$/;
          if (v === "" || pattern.test(v)) onChange(v);
        }}
        className="num h-full min-w-0 flex-1 bg-transparent text-[17px] text-ink outline-none placeholder:text-ink-4 focus-visible:outline-none"
      />
      {unit ? <span className="shrink-0 text-[13.5px] text-ink-3">{unit}</span> : null}
    </div>
  );
}

export function TextInput({
  id,
  value,
  onChange,
  maxLength,
  placeholder,
  invalid,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
  placeholder?: string;
  invalid?: boolean;
}) {
  return (
    <div className={cn(shell, invalid && "shadow-[0_0_0_1px_rgb(177_63_57/0.55)]")}>
      <input
        id={id}
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        aria-invalid={invalid || undefined}
        onChange={(e) => onChange(e.target.value)}
        className="h-full min-w-0 flex-1 bg-transparent text-[16px] text-ink outline-none placeholder:text-ink-4 focus-visible:outline-none"
      />
    </div>
  );
}

/** A pill group for two to four choices. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: readonly { value: T; label: ReactNode }[];
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn("inline-flex rounded-full bg-sunken p-1", className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "h-9 rounded-full px-4 text-[14px] transition-[color,background-color,box-shadow] duration-200",
              active ? "bg-surface font-medium text-ink shadow-hairline" : "text-ink-2 hover:text-ink",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * A calm slider: a native range input (keyboard and screen readers) over a drawn track. The fill scales with a
 * transform; the thumb follows the pointer directly.
 */
export function Slider({
  id,
  value,
  min,
  max,
  step = 1,
  onChange,
  ariaLabel,
  valueText,
  tone = "accent",
}: {
  id?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  ariaLabel: string;
  valueText?: string;
  tone?: "accent" | "ink";
}) {
  const span = max - min;
  const t = span > 0 ? Math.min(1, Math.max(0, (value - min) / span)) : 1;
  return (
    <div className="group relative h-8 touch-none select-none">
      <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-sunken-2">
        <div
          className={cn("h-full w-full origin-left rounded-full", tone === "accent" ? "bg-accent" : "bg-ink")}
          style={{ transform: `scaleX(${t})` }}
        />
      </div>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 size-5 -translate-y-1/2 rounded-full border border-line-strong bg-surface shadow-soft group-has-[input:focus-visible]:shadow-[0_0_0_2px_var(--color-accent),0_0_0_6px_var(--color-accent-soft)]"
        style={{ left: `calc(${t} * (100% - 1.25rem))` }}
      />
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={ariaLabel}
        aria-valuetext={valueText}
        disabled={span <= 0}
        onChange={(e) => onChange(Number(e.target.value))}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0 focus-visible:outline-none disabled:cursor-default"
      />
    </div>
  );
}
