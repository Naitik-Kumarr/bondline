"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { CloseIcon, MenuIcon } from "@/components/ui/icons";
import { clsx as cn } from "clsx";
import { NAV } from "./nav";

const isActive = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

/** The wallet pages load wagmi and RainbowKit; don't prefetch them from every page, so read pages stay light. */
const prefetchFor = (href: string) => (href === "/underwrite" || href === "/cover" ? false : undefined);

/** Desktop links with an active state. */
export function DesktopNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
      {NAV.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            prefetch={prefetchFor(item.href)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative rounded-full px-3.5 py-2 text-[14px] transition-colors",
              active ? "bg-sunken text-ink" : "text-ink-2 hover:text-ink",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Phone menu: a button that opens a card of links under the header. Closes on navigation, Escape or outside tap. */
export function MobileNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  return (
    <div ref={root} className="md:hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex size-9 items-center justify-center rounded-full text-ink transition-colors hover:bg-ink/5"
      >
        {open ? <CloseIcon size={18} /> : <MenuIcon size={18} />}
      </button>
      <div
        id={id}
        hidden={!open}
        className="absolute inset-x-0 top-[calc(100%+8px)] rounded-card-lg border border-line bg-surface p-2 shadow-lift"
      >
        <nav aria-label="Main" className="flex flex-col">
          {NAV.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                prefetch={prefetchFor(item.href)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-2xl px-4 py-3.5 text-[16px] transition-colors",
                  active ? "bg-sunken text-ink" : "text-ink-2 hover:bg-sunken hover:text-ink",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
