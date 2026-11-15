import { useSyncExternalStore } from 'react';
import type { Permission } from '@/domain/permissions';

/**
 * The screens of the restaurant app; each lives at `#/<route>`, which works offline and from a
 * file. The market's own screens (register, stock, credit customers, suppliers, invoices) are
 * Market Kasa's and have no address here.
 */
export type Route = 'tables' | 'kitchen' | 'products' | 'reports' | 'settings';

const ROUTES: readonly Route[] = ['tables', 'kitchen', 'products', 'reports', 'settings'];

/** What a person must be allowed to open each screen; the floor and the kitchen are open to all. */
export const ROUTE_PERMISSIONS: Partial<Record<Route, Permission>> = {
  products: 'editProducts',
  reports: 'reports',
  settings: 'admin',
};

/** The screen an address names; the floor of tables for anything else. */
export function parseRoute(hash: string): Route {
  const name = hash.replace(/^#\//, '');
  return ROUTES.find((route) => route === name) ?? 'tables';
}

/** The current screen, following the address as links and the back button change it. */
export function useRoute(): Route {
  return useSyncExternalStore(subscribe, () => parseRoute(window.location.hash));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}
