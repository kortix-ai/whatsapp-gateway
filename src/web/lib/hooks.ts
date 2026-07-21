import { useEffect, useState } from 'react';

export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

/** Milliseconds remaining until `target`, ticking every second (null when absent/past). */
export function useCountdown(target: string | number | Date | null | undefined): number | null {
  const targetMs = target ? new Date(target).getTime() : null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!targetMs) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [targetMs]);
  if (!targetMs || Number.isNaN(targetMs)) return null;
  return Math.max(0, targetMs - now);
}
