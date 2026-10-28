"use client";

import { useEffect } from "react";

const KEY = "kroov.kc";

/**
 * Campaign attribution (phase 8): keeps the `kc` parameter of a tracked campaign link for the
 * current browser session so a reservation made a few pages later can be attributed. Session
 * storage only (cleared when the tab closes), no identity resolution, best effort.
 */
export function AttributionKeeper() {
  useEffect(() => {
    try {
      const kc = new URLSearchParams(window.location.search).get("kc");
      if (kc && /^[A-Za-z0-9_.-]{16,200}$/.test(kc)) window.sessionStorage.setItem(KEY, kc);
    } catch {
      /* storage unavailable: attribution simply not kept */
    }
  }, []);
  return null;
}

export function currentAttribution(): string | undefined {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get("kc");
    const kc = fromUrl ?? window.sessionStorage.getItem(KEY);
    return kc && /^[A-Za-z0-9_.-]{16,200}$/.test(kc) ? kc : undefined;
  } catch {
    return undefined;
  }
}
