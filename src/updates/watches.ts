import { APP_VERSION } from '@/app/version';
import { isNewer, latestReleaseVersion } from '@/settings/updates';
import { createReleaseWatch, type Found, type ReleaseWatch } from './releaseWatch';
import { findNewBuild } from './webBuild';

/** A check for a GitHub release later than `current`, as the Android app installs them. */
export function findNewerRelease(
  current: string,
  latest: () => Promise<string | null> = latestReleaseVersion,
): () => Promise<Found | null> {
  return async () => {
    const version = await latest();
    if (version === null) {
      throw new Error('No release could be read');
    }
    return isNewer(version, current) ? { version } : null;
  };
}

/** This device's storage, or a forgetful stand-in where the browser refuses it. */
function deviceStorage(): Storage {
  try {
    return window.localStorage;
  } catch {
    const kept = new Map<string, string>();
    return {
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: (key: string, value: string) => void kept.set(key, value),
    } as Storage;
  }
}

let android: ReleaseWatch | undefined;
let web: ReleaseWatch | undefined;

/** The Android app's watch on GitHub releases; the notice and Settings share it. */
export function androidWatch(): ReleaseWatch {
  android ??= createReleaseWatch({
    find: findNewerRelease(APP_VERSION),
    storage: deviceStorage(),
  });
  return android;
}

/** The web app's watch on what is deployed beside it; the notice and Settings share it. */
export function webWatch(): ReleaseWatch {
  web ??= createReleaseWatch({ find: findNewBuild(), storage: deviceStorage() });
  return web;
}
