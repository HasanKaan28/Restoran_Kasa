import { useEffect } from 'react';
import type { ReleaseWatch } from './releaseWatch';
import { dialogOpen } from './workGuard';

/** How often an app left open all day looks for a new release (as the desktop app does). */
export const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;
/** A check waits this long after the app opens, so it never slows the first screen. */
export const START_DELAY_MS = 5000;
/** How often an open app asks itself whether a check is due. */
export const TICK_MS = 5 * 60 * 1000;

/**
 * Checks for a new release when the app starts (`always`, or only when the last check is old),
 * then at most every few hours while it stays open, when the line comes back and when the app
 * returns to the front. Never offline, and never during an open dialog such as a payment.
 */
export function useScheduledChecks(
  watch: ReleaseWatch,
  {
    checkOnStart,
    enabled = true,
    startDelayMs = START_DELAY_MS,
  }: { checkOnStart: 'always' | 'when-due'; enabled?: boolean; startDelayMs?: number },
): void {
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const due = () => {
      const at = watch.get().checkedAt;
      return at === null || Date.now() - at >= CHECK_EVERY_MS;
    };
    const checkIf = (wanted: boolean) => {
      if (wanted && navigator.onLine !== false && !dialogOpen()) {
        void watch.check();
      }
    };
    const whenDue = () => checkIf(due());
    const whenShown = () => {
      if (document.visibilityState !== 'hidden') {
        whenDue();
      }
    };
    const start = setTimeout(() => checkIf(checkOnStart === 'always' || due()), startDelayMs);
    const tick = setInterval(whenDue, TICK_MS);
    window.addEventListener('online', whenDue);
    document.addEventListener('visibilitychange', whenShown);
    return () => {
      clearTimeout(start);
      clearInterval(tick);
      window.removeEventListener('online', whenDue);
      document.removeEventListener('visibilitychange', whenShown);
    };
  }, [watch, checkOnStart, enabled, startDelayMs]);
}
