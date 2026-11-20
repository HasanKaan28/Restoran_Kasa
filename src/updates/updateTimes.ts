/** When this device last heard back from an update check, in ms since 1970. */
export const CHECKED_KEY = 'rk.update.checkedAt';
/** The release someone put off with "Sonra", and until when: `{ version, until }`. */
export const SNOOZE_KEY = 'rk.update.snooze';
/** How long "Sonra" keeps a release quiet. */
export const SNOOZE_MS = 24 * 60 * 60 * 1000;

// A private window or a locked-down webview can refuse storage: updates then just forget.
function read(storage: Storage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function write(storage: Storage, key: string, value: string): void {
  try {
    storage.setItem(key, value);
  } catch {
    // Nothing kept; the next check or "Sonra" simply happens again.
  }
}

export function loadCheckedAt(storage: Storage): number | null {
  const at = Number(read(storage, CHECKED_KEY) ?? NaN);
  return Number.isFinite(at) ? at : null;
}

export function saveCheckedAt(storage: Storage, at: number): void {
  write(storage, CHECKED_KEY, String(at));
}

/** "Sonra": this release stays quiet on this device for a day. */
export function snoozeRelease(storage: Storage, version: string, now: number): void {
  write(storage, SNOOZE_KEY, JSON.stringify({ version, until: now + SNOOZE_MS }));
}

/** Whether `version` was put off and the day is not over; a newer release is never quiet. */
export function isSnoozed(storage: Storage, version: string, now: number): boolean {
  try {
    const kept = JSON.parse(read(storage, SNOOZE_KEY) ?? 'null') as {
      version?: unknown;
      until?: unknown;
    } | null;
    return kept?.version === version && typeof kept.until === 'number' && now < kept.until;
  } catch {
    return false;
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** "Son denetim: bugün 14:05", "dün 18:05" or "17 Kasım 14:05", in the device's time zone. */
export function describeCheckedAt(at: number | null, now: number, timeZone?: string): string {
  if (at === null) {
    return 'Henüz denetlenmedi';
  }
  if (now - at < 60_000) {
    return 'Son denetim: az önce';
  }
  const zone = timeZone ? { timeZone } : {};
  const day = new Intl.DateTimeFormat('tr-TR', { ...zone, dateStyle: 'short' });
  const time = new Intl.DateTimeFormat('tr-TR', {
    ...zone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(at);
  const when =
    day.format(at) === day.format(now)
      ? 'bugün'
      : day.format(at) === day.format(now - DAY_MS)
        ? 'dün'
        : new Intl.DateTimeFormat('tr-TR', { ...zone, day: 'numeric', month: 'long' }).format(at);
  return `Son denetim: ${when} ${time}`;
}
