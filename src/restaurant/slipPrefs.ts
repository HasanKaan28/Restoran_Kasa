import type { SlipMode } from './orderSlip';

/**
 * Whether this device prints an order slip as orders come in, and since when. Kept on the
 * device, not synced: only the one with the printer (the bar's or the till's PC) prints.
 */
export type SlipPrefs =
  | { mode: 'off' }
  | {
      mode: Exclude<SlipMode, 'off'>;
      /** When this choice was made (ISO): an order sent before it is never printed. */
      since: string;
      /**
       * The market it was made in. In another market (the device joined another restaurant) it
       * starts again from that moment, so that market's earlier orders are not printed.
       */
      marketId: string;
    };

export const DEFAULT_SLIP_PREFS: SlipPrefs = { mode: 'off' };

export const SLIP_STORAGE_KEY = 'rk.orderSlip';

/** The stored choice; off when missing, unreadable or without the moment it was made. */
export function loadSlipPrefs(storage?: Pick<Storage, 'getItem'>): SlipPrefs {
  try {
    const raw = (storage ?? localStorage).getItem(SLIP_STORAGE_KEY);
    const parsed = (raw === null ? {} : JSON.parse(raw)) as Partial<
      Record<'mode' | 'since' | 'marketId', unknown>
    >;
    if (
      (parsed.mode === 'delivered' || parsed.mode === 'all') &&
      typeof parsed.since === 'string' &&
      !Number.isNaN(Date.parse(parsed.since))
    ) {
      return {
        mode: parsed.mode,
        since: parsed.since,
        // Unknown market: taken as another one, so it starts again from now.
        marketId: typeof parsed.marketId === 'string' ? parsed.marketId : '',
      };
    }
    return DEFAULT_SLIP_PREFS;
  } catch {
    return DEFAULT_SLIP_PREFS;
  }
}

/**
 * Makes a choice in a market and tells the printer running on this page at once. Turning
 * printing on, changing what is printed, or the same choice in another market starts from now:
 * nothing sent before is printed.
 */
export function chooseSlipMode(
  mode: SlipMode,
  now: Date,
  marketId: string,
  storage?: Pick<Storage, 'getItem' | 'setItem'>,
): void {
  const current = unsaved ?? loadSlipPrefs(storage);
  if (current.mode === mode && (current.mode === 'off' || current.marketId === marketId)) {
    return;
  }
  const next: SlipPrefs = mode === 'off' ? { mode } : { mode, since: now.toISOString(), marketId };
  try {
    (storage ?? localStorage).setItem(SLIP_STORAGE_KEY, JSON.stringify(next));
    unsaved = undefined;
  } catch {
    // Storage blocked: the choice lasts until the app is closed.
    unsaved = next;
  }
  for (const listener of listeners) {
    listener();
  }
}

const listeners = new Set<() => void>();
let unsaved: SlipPrefs | undefined;
let last: { raw: string | null; prefs: SlipPrefs } | undefined;

/** For useSyncExternalStore: the choice as stored, the same object while it is unchanged. */
export function slipPrefsSnapshot(): SlipPrefs {
  if (unsaved) {
    return unsaved;
  }
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(SLIP_STORAGE_KEY);
  } catch {
    // Unreadable storage: off.
  }
  if (last?.raw !== raw) {
    last = { raw, prefs: loadSlipPrefs({ getItem: () => raw }) };
  }
  return last.prefs;
}

export function subscribeSlipPrefs(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
