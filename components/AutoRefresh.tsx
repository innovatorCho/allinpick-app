"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Re-renders the current page from the server every `intervalMs` while
 * mounted, for at most `stopAfterMs`. Used on a product whose details the
 * collector worker hasn't filled in yet, so they appear without the shopper
 * reloading; the cap keeps a forgotten tab from polling forever.
 */
export function AutoRefresh({ intervalMs, stopAfterMs }: { intervalMs: number; stopAfterMs: number }) {
  const router = useRouter();
  useEffect(() => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - startedAt > stopAfterMs) clearInterval(timer);
      else router.refresh();
    }, intervalMs);
    return () => clearInterval(timer);
  }, [router, intervalMs, stopAfterMs]);
  return null;
}
