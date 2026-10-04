import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Container } from "./Container";
import { Reveal } from "./Reveal";

type SectionProps = ComponentProps<"section"> & {
  /** Vertical rhythm. `lg` for landing sections, `md` for app pages. */
  spacing?: "sm" | "md" | "lg";
  container?: "narrow" | "default" | "wide" | false;
};

const spacings = {
  sm: "py-10 sm:py-14",
  md: "py-16 sm:py-24",
  lg: "py-24 sm:py-36",
};

/** One idea per section: generous vertical space, centred column. */
export function Section({ spacing = "md", container = "default", className, children, ...rest }: SectionProps) {
  return (
    <section className={cn("relative", spacings[spacing], className)} {...rest}>
      {container === false ? children : <Container size={container}>{children}</Container>}
    </section>
  );
}

/** Eyebrow, display title and a lead paragraph. Eases in on scroll. */
export function SectionHeader({
  eyebrow,
  title,
  lead,
  align = "left",
  size = "l",
  className,
  reveal = true,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  lead?: ReactNode;
  align?: "left" | "center";
  size?: "l" | "m";
  className?: string;
  reveal?: boolean;
}) {
  const body = (
    <>
      {eyebrow ? <p className="eyebrow mb-4">{eyebrow}</p> : null}
      <h2
        className={cn(
          "font-display text-ink",
          size === "l" ? "text-display-l" : "text-display-m",
          align === "center" && "mx-auto",
        )}
      >
        {title}
      </h2>
      {lead ? (
        <p
          className={cn(
            "mt-5 max-w-[38rem] text-[17px] leading-relaxed text-ink-2 sm:text-lg",
            align === "center" && "mx-auto",
          )}
        >
          {lead}
        </p>
      ) : null}
    </>
  );
  const classes = cn(align === "center" && "text-center", className);
  return reveal ? <Reveal className={classes}>{body}</Reveal> : <div className={classes}>{body}</div>;
}

/** The accented word in a display heading: italic, periwinkle. Use once per heading. */
export function Accent({ children, tone = "accent" }: { children: ReactNode; tone?: "accent" | "bond" }) {
  return <em className={cn("italic", tone === "accent" ? "text-accent-ink" : "text-bond-ink")}>{children}</em>;
}
