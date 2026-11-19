import type { DeviceSettings } from './device';

/** What an earlier version stored when a shop chose to try the app without an account. */
const OLD_SKIP_FLAG = 'rk.welcomeSkipped';

/** The first screen shows on every device not yet bound to a restaurant: no use without an account. */
export function shouldWelcome(settings: DeviceSettings): boolean {
  return !settings.paired;
}

/** Drops the flag an earlier version kept for "try without a server"; it no longer opens anything. */
export function forgetSkippedWelcome(storage: Pick<Storage, 'removeItem'>): void {
  try {
    storage.removeItem(OLD_SKIP_FLAG);
  } catch {
    // Without storage the flag was never kept.
  }
}
