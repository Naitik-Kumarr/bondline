"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Re-reads the page's server data every `every` ms while the tab is visible, so chain numbers stay current and
 * NumberFlow animates the ones that change. The server side is cached (revalidate), so this stays cheap.
 */
export function AutoRefresh({ every = 30_000 }: { every?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, every);
    return () => window.clearInterval(id);
  }, [router, every]);
  return null;
}
