import type { SyncRunner } from '@/sync/runner';

/**
 * How often an open register syncs. A waiter's order reaches the kitchen screen, and the kitchen's
 * "ready" the waiter's floor, within this; the market's minute was far too long for a restaurant.
 */
export const SYNC_INTERVAL_MS = 10_000;

/**
 * Keeps this register in step with the restaurant's others: a round every SYNC_INTERVAL_MS, and
 * one at once when the network comes back or the screen is shown again (a phone taken out of a
 * pocket), rather than at the next round. Returns what stops it.
 */
export function keepSyncing(
  runner: Pick<SyncRunner, 'run' | 'start' | 'stop'>,
  target: Window = window,
): () => void {
  const now = () => void runner.run();
  const shown = () => {
    if (target.document.visibilityState === 'visible') {
      now();
    }
  };
  runner.start(SYNC_INTERVAL_MS);
  target.addEventListener('online', now);
  target.document.addEventListener('visibilitychange', shown);
  return () => {
    runner.stop();
    target.removeEventListener('online', now);
    target.document.removeEventListener('visibilitychange', shown);
  };
}
