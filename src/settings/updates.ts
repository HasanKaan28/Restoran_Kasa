import { Capacitor } from '@capacitor/core';

/** What the desktop app's updater reports (electron/updates.cjs). */
export type UpdateStatus =
  | { kind: 'checking' }
  /** `installNow`: found while the app was starting, so it goes in once downloaded. */
  | { kind: 'available'; version: string; installNow?: boolean }
  | { kind: 'current' }
  /** `version` is the release coming down, when the updater knows it. */
  | { kind: 'downloading'; percent: number; installNow?: boolean; version?: string }
  /** Downloaded while the register was at work; it goes in when the app closes. */
  | { kind: 'ready'; version: string }
  | { kind: 'installing'; version: string }
  | { kind: 'error' };

/** The bridge the desktop app's preload script puts on `window.marketKasa.updates`. */
export type DesktopUpdates = {
  check(): Promise<unknown>;
  install(): Promise<unknown>;
  onStatus(callback: (status: UpdateStatus) => void): () => void;
};

const RELEASES = 'https://github.com/HasanKaan28/Restoran_Kasa/releases';
export const APK_URL = `${RELEASES}/latest/download/Restoran-Kasa.apk`;

/** The version of the latest published release, from GitHub. */
export async function latestReleaseVersion(): Promise<string | null> {
  const response = await fetch(
    'https://api.github.com/repos/HasanKaan28/Restoran_Kasa/releases/latest',
    { headers: { Accept: 'application/vnd.github+json' } },
  );
  if (!response.ok) {
    return null;
  }
  const { tag_name: tag } = (await response.json()) as { tag_name?: string };
  return typeof tag === 'string' ? tag.replace(/^v/, '') : null;
}

/** True when `latest` is a later x.y.z than `current`. */
export function isNewer(latest: string, current: string): boolean {
  const parts = (version: string) => version.split(/[.-]/).slice(0, 3).map(Number);
  const [a, b] = [parts(latest), parts(current)];
  for (let index = 0; index < 3; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) {
      return difference > 0;
    }
  }
  return false;
}

/** Where this app runs, for updates: the desktop app, the Android app or a browser. */
export type UpdateTarget = { desktop?: DesktopUpdates; android: boolean; web: boolean };

/** Finds the desktop bridge, or an Android phone (as Capacitor tells), or else the web app. */
export function updateTarget(): UpdateTarget {
  const bridge = (window as { marketKasa?: { updates?: DesktopUpdates } }).marketKasa?.updates;
  const native = Capacitor.isNativePlatform();
  return {
    ...(bridge ? { desktop: bridge } : {}),
    android: native && Capacitor.getPlatform() === 'android',
    web: !bridge && !native,
  };
}

/** The release notes on GitHub: of `version` when one was found, else of the latest release. */
export function releaseNotesUrl(version?: string): string {
  return version ? `${RELEASES}/tag/v${version}` : `${RELEASES}/latest`;
}
