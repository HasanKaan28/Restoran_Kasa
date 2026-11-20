import { useSyncExternalStore } from 'react';
import { loadCheckedAt, saveCheckedAt } from './updateTimes';

/** A newer release or deploy than the one running. */
export type Found = { version: string };

export type WatchState = {
  checking: boolean;
  /** When a check last came back, here or in an earlier session on this device. */
  checkedAt: number | null;
  /** What a check found; kept when a later check fails. */
  found: Found | null;
  /** The last check could not reach the server. */
  failed: boolean;
};

/** One place the update notice and Settings → Güncelleme both read and both ask to check. */
export type ReleaseWatch = {
  get(): WatchState;
  subscribe(listener: () => void): () => void;
  check(): Promise<void>;
};

/**
 * Watches for a newer release with `find`, which answers what it found or null when the running
 * one is the latest, and throws when it cannot tell (offline, server down).
 */
export function createReleaseWatch({
  find,
  storage,
  now = Date.now,
}: {
  find(): Promise<Found | null>;
  storage: Storage;
  now?: () => number;
}): ReleaseWatch {
  let state: WatchState = {
    checking: false,
    checkedAt: loadCheckedAt(storage),
    found: null,
    failed: false,
  };
  const listeners = new Set<() => void>();
  let running: Promise<void> | undefined;

  const set = (next: Partial<WatchState>) => {
    state = { ...state, ...next };
    listeners.forEach((listener) => listener());
  };

  const run = async () => {
    set({ checking: true });
    try {
      const found = await find();
      const at = now();
      saveCheckedAt(storage, at);
      set({ checking: false, checkedAt: at, found: found ?? state.found, failed: false });
    } catch {
      set({ checking: false, failed: true });
    }
  };

  return {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    check() {
      running ??= run().finally(() => {
        running = undefined;
      });
      return running;
    },
  };
}

/** The watch's state, following each check. */
export function useReleaseWatch(watch: ReleaseWatch): WatchState {
  return useSyncExternalStore(watch.subscribe, watch.get, watch.get);
}
