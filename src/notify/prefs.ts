/**
 * How this device tells its waiter that an order is ready. Kept on the device, not synced: the
 * waiter's phone wants a sound and a buzz, the till by the kitchen door perhaps nothing at all.
 */
export type NotifyPrefs = {
  enabled: boolean;
  /** `mine`: only the lines the person signed in here (or this device) ordered; `all`: every one. */
  scope: 'mine' | 'all';
  sound: boolean;
  vibrate: boolean;
};

export const DEFAULT_NOTIFY_PREFS: NotifyPrefs = {
  enabled: true,
  scope: 'mine',
  sound: true,
  vibrate: true,
};

export const NOTIFY_STORAGE_KEY = 'rk.notify';

/** The stored choices, each one falling back to its default when missing or unreadable. */
export function loadNotifyPrefs(storage?: Pick<Storage, 'getItem'>): NotifyPrefs {
  try {
    const raw = (storage ?? localStorage).getItem(NOTIFY_STORAGE_KEY);
    const parsed = (raw === null ? {} : JSON.parse(raw)) as Partial<
      Record<keyof NotifyPrefs, unknown>
    >;
    return {
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : DEFAULT_NOTIFY_PREFS.enabled,
      scope: parsed.scope === 'all' ? 'all' : 'mine',
      sound: typeof parsed.sound === 'boolean' ? parsed.sound : DEFAULT_NOTIFY_PREFS.sound,
      vibrate: typeof parsed.vibrate === 'boolean' ? parsed.vibrate : DEFAULT_NOTIFY_PREFS.vibrate,
    };
  } catch {
    return DEFAULT_NOTIFY_PREFS;
  }
}

/** Saves the choices and tells the notifier running on this page at once. */
export function saveNotifyPrefs(prefs: NotifyPrefs, storage?: Pick<Storage, 'setItem'>): void {
  try {
    (storage ?? localStorage).setItem(NOTIFY_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Storage blocked: the choice lasts until the app is closed.
    unsaved = prefs;
  }
  for (const listener of listeners) {
    listener();
  }
}

const listeners = new Set<() => void>();
let unsaved: NotifyPrefs | undefined;
let last: { raw: string | null; prefs: NotifyPrefs } | undefined;

/** For useSyncExternalStore: the choices as stored, the same object while they are unchanged. */
export function notifyPrefsSnapshot(): NotifyPrefs {
  if (unsaved) {
    return unsaved;
  }
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(NOTIFY_STORAGE_KEY);
  } catch {
    // Unreadable storage: the defaults.
  }
  if (last?.raw !== raw) {
    last = { raw, prefs: loadNotifyPrefs({ getItem: () => raw }) };
  }
  return last.prefs;
}

export function subscribeNotifyPrefs(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
