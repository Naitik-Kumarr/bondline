import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { ArrowUpRightIcon, Spinner } from "./icons";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "bond" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const base =
  "group/button relative isolate inline-flex shrink-0 select-none items-center justify-center gap-2 overflow-hidden whitespace-nowrap rounded-full font-medium " +
  "transition-transform duration-[var(--duration-spring)] ease-spring hover:-translate-y-px active:translate-y-0 active:scale-[0.97] " +
  // Hover highlight fades in on a pseudo-element: opacity only.
  "before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:rounded-full before:opacity-0 before:transition-opacity before:duration-200 hover:before:opacity-100 " +
  // Disabled dims; loading (also disabled) keeps its colour and shows a spinner.
  "disabled:pointer-events-none [&:disabled:not([data-loading])]:opacity-45 aria-disabled:pointer-events-none aria-disabled:opacity-45 " +
  "motion-reduce:transition-none motion-reduce:hover:translate-y-0";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-ink text-white shadow-pill before:bg-white/12",
  secondary: "bg-surface text-ink shadow-hairline before:bg-ink/[0.045]",
  ghost: "text-ink-2 hover:text-ink before:bg-ink/[0.05]",
  bond: "bg-bond-soft text-bond-ink shadow-[inset_0_0_0_1px_rgb(156_74_34/0.14)] before:bg-bond/25",
  danger: "bg-negative-soft text-negative shadow-[inset_0_0_0_1px_rgb(177_63_57/0.14)] before:bg-negative/10",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-9 px-4 text-[13.5px]",
  md: "h-11 px-5 text-[15px]",
  lg: "h-12 px-6 text-base",
};

export function buttonClasses({
  variant = "primary",
  size = "md",
  className,
}: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}) {
  return cn(base, variants[variant], sizes[size], className);
}

type CommonProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Icon before the label. */
  icon?: ReactNode;
  /** Icon after the label. */
  iconRight?: ReactNode;
};

export type ButtonProps = ComponentProps<"button"> &
  CommonProps & {
    /** Shows a spinner, keeps the button's width, and disables it. */
    loading?: boolean;
    /** Screen-reader text while loading, e.g. "Waiting for your wallet". */
    loadingLabel?: string;
  };

/** Pill button. Primary is dark, secondary is light. */
export function Button({
  variant = "primary",
  size = "md",
  icon,
  iconRight,
  loading = false,
  loadingLabel,
  disabled,
  className,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      data-loading={loading ? "" : undefined}
      className={buttonClasses({ variant, size, className })}
      {...rest}
    >
      <span className={cn("inline-flex items-center gap-2", loading && "invisible")}>
        {icon}
        {children}
        {iconRight}
      </span>
      {loading ? (
        <span className="absolute inset-0 flex items-center justify-center">
          <Spinner size={size === "sm" ? 14 : 16} />
          {loadingLabel ? <span className="sr-only">{loadingLabel}</span> : null}
        </span>
      ) : null}
    </button>
  );
}

export type ButtonLinkProps = Omit<ComponentProps<typeof Link>, "href"> &
  CommonProps & {
    href: string;
    /** Opens in a new tab and adds an outbound arrow. Use for explorer and source links. */
    external?: boolean;
  };

/** A link that looks like a pill button. Internal routes use next/link. */
export function ButtonLink({
  href,
  external,
  variant = "primary",
  size = "md",
  icon,
  iconRight,
  className,
  children,
  ...rest
}: ButtonLinkProps) {
  const classes = buttonClasses({ variant, size, className });
  const content = (
    <>
      {icon}
      {children}
      {iconRight ?? (external ? <ArrowUpRightIcon size={14} className="opacity-60" /> : null)}
    </>
  );
  if (external) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={classes}
        {...(rest as ComponentProps<"a">)}
      >
        {content}
      </a>
    );
  }
  return (
    <Link href={href} className={classes} {...rest}>
      {content}
    </Link>
  );
}
