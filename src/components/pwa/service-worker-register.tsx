"use client";

import { useEffect } from "react";

/** Registers /sw.js in production builds only (dev reloads would fight the cache). */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {
      // Not fatal: the app works without the offline page.
    });
  }, []);
  return null;
}
