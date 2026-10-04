import type { ComponentProps, ElementType, ReactNode } from "react";
import { cn } from "@/lib/cn";

const sizes = {
  narrow: "max-w-[46rem]",
  default: "max-w-[72rem]",
  wide: "max-w-[80rem]",
} as const;

/** Centred page column with a 20px gutter on phones and 32px on desktop. */
export function Container<T extends ElementType = "div">({
  as,
  size = "default",
  className,
  children,
  ...rest
}: {
  as?: T;
  size?: keyof typeof sizes;
  className?: string;
  children?: ReactNode;
} & Omit<ComponentProps<T>, "as" | "className" | "children">) {
  const Tag = (as ?? "div") as ElementType;
  return (
    <Tag className={cn("mx-auto w-full px-5 sm:px-8", sizes[size], className)} {...rest}>
      {children}
    </Tag>
  );
}
