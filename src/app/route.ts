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
  const name = hash.replace(/^#\//, '').split('/')[0];
  return ROUTES.find((route) => route === name) ?? 'tables';
}

/** The current screen, following the address as links and the back button change it. */
export function useRoute(): Route {
  return useSyncExternalStore(subscribe, () => parseRoute(window.location.hash));
}

const TAB_ADDRESS = /^#\/tables\/([0-9A-Za-z-]{1,64})$/;

/** The tab open on the floor (`#/tables/<id>`), or null on the floor itself. */
export function parseTabId(hash: string): string | null {
  return TAB_ADDRESS.exec(hash)?.[1] ?? null;
}

export function tabAddress(tabId: string): string {
  return `#/tables/${tabId}`;
}

/** The tab open on the floor, following the address. */
export function useTabId(): string | null {
  return useSyncExternalStore(subscribe, () => parseTabId(window.location.hash));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

/** Marks a history entry as a tab opened from the floor (kept by the entry, over a reload too). */
const FROM_FLOOR = 'rk.fromFloor';
let leaving = false;

/** Opens a tab at its own address; the phone's back gesture then returns to the floor. */
export function openTabScreen(tabId: string): void {
  const hash = window.location.hash;
  const fromFloor = parseRoute(hash) === 'tables' && parseTabId(hash) === null;
  window.location.hash = tabAddress(tabId);
  if (fromFloor) {
    window.history.replaceState({ [FROM_FLOOR]: true }, '');
  }
}

/**
 * Back from a tab to the floor: one step back in history when the floor opened it, so the
 * forward entry is the tab and not a second floor; otherwise (a link, a typed address) the
 * address is replaced. Safe to call more than once while the first is still on its way.
 */
export function leaveTabScreen(): void {
  if (leaving || parseTabId(window.location.hash) === null) {
    return;
  }
  const state: unknown = window.history.state;
  if (typeof state === 'object' && state !== null && FROM_FLOOR in state) {
    leaving = true;
    window.addEventListener('hashchange', () => (leaving = false), { once: true });
    window.history.back();
    return;
  }
  window.history.replaceState(null, '', '#/tables');
  window.dispatchEvent(new Event('hashchange'));
}
