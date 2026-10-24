import { useEffect, useReducer, useState } from "react";
import { useLive } from "@naghma/ui";
import type { PerformanceStore } from "./live";
import type { LiveFrame } from "./types";

/** A frame is fresh while frames keep arriving (main-window clock). */
export const FRESH_MS = 500;

/**
 * Latest frame at most `maxHz` times per second, plus whether it is still
 * fresh. Re-renders once more when it goes stale, so callers never need an
 * app-wide clock.
 */
export function useFreshFrame(
  store: PerformanceStore,
  maxHz = 15,
): { frame: LiveFrame | null; fresh: boolean } {
  const frame = useLive(store, (f) => f, Object.is, maxHz);
  const [, expire] = useReducer((n: number) => n + 1, 0);
  const age = performance.now() - store.receivedAt;
  const fresh = !!frame && age < FRESH_MS;
  useEffect(() => {
    if (!fresh) return;
    const id = setTimeout(expire, FRESH_MS - age + 10);
    return () => clearTimeout(id);
  }, [frame, fresh, age]);
  return { frame, fresh };
}

/** Wall-clock-free ticker for slow labels such as "12 s ago". */
export function useNow(intervalMs: number, enabled = true): number {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (!enabled) return;
    setNow(performance.now());
    const id = setInterval(() => setNow(performance.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, enabled]);
  return now;
}
