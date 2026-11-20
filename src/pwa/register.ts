export type Where = {
  /** A production build; a worker in development would serve stale modules. */
  prod: boolean;
  /** The Android app, which ships its files inside and updates through the store. */
  native: boolean;
  protocol: string;
  hostname: string;
};

/** Browsers allow a worker on https, or on localhost for trying a build. */
export function shouldRegister({ prod, native, protocol, hostname }: Where): boolean {
  if (!prod || native) {
    return false;
  }
  return protocol === 'https:' || (protocol === 'http:' && hostname === 'localhost');
}

/** Installs the worker that keeps the app opening offline; a refusal leaves the app as it was. */
export async function registerServiceWorker(
  where: Where,
  version: string,
  build: string,
): Promise<void> {
  if (!shouldRegister(where) || !('serviceWorker' in navigator)) {
    return;
  }
  try {
    // The version and build in the address make each deploy a new worker with its own cache,
    // even one that kept the version number: the same address would leave the old worker on.
    const address = `./sw.js?v=${encodeURIComponent(version)}&b=${encodeURIComponent(build)}`;
    await navigator.serviceWorker.register(address, { scope: './' });
  } catch {
    // Private windows and some policies block workers; the app still runs online.
  }
}
