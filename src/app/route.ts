import { useSyncExternalStore } from 'react';
import type { Permission } from '@/domain/permissions';

/**
 * The screens of the restaurant app; each lives at `#/<route>`, which works offline and from a
 * file. The market's own screens (register, stock, credit customers, suppliers, invoices) are
 * Market Kasa's and have no address here.
 */
export type Route = 'tables' | 'kitchen' | 'products' | 'manage' | 'settings';

const ROUTES: readonly Route[] = ['tables', 'kitchen', 'products', 'manage', 'settings'];

/** The sections of Yönetim, each at `#/manage/<section>`, in the order its tabs show them. */
export type ManageSection = 'reports' | 'staff' | 'credit' | 'stock' | 'suppliers' | 'archive';

export const MANAGE_SECTIONS: readonly ManageSection[] = [
  'reports',
  'staff',
  'credit',
  'stock',
  'suppliers',
  'archive',
];

/** Reports lived at `#/reports` until v1.0.4; that address still opens them. */
const OLD_REPORTS = 'reports';

type Can = (permission: Permission) => boolean;

/** Who may open each section of Yönetim. */
export const SECTION_ACCESS: Record<ManageSection, (can: Can) => boolean> = {
  reports: (can) => can('reports'),
  staff: (can) => can('reports'),
  credit: (can) => can('creditSale') || can('collect'),
  stock: (can) => can('stock') || can('count'),
  suppliers: (can) => can('suppliers'),
  archive: (can) => can('reports'),
};

/**
 * Whether a person may open a screen. The floor and the kitchen are open to all; Yönetim to
 * whoever may open any one of its sections. A person without `admin` still gets this device's
 * own settings (DeviceSettingsScreen), not the shared ones.
 */
export function canOpenRoute(route: Route, can: Can): boolean {
  switch (route) {
    case 'tables':
    case 'kitchen':
      return true;
    case 'products':
      return can('editProducts');
    case 'manage':
      return MANAGE_SECTIONS.some((section) => SECTION_ACCESS[section](can));
    case 'settings':
      return can('admin');
  }
}

/** The address's path, without the leading `#/`. */
function pathOf(hash: string): string[] {
  return hash.replace(/^#\//, '').split('/');
}

/** The screen an address names; the floor of tables for anything else. */
export function parseRoute(hash: string): Route {
  const name = pathOf(hash)[0];
  if (name === OLD_REPORTS) {
    return 'manage';
  }
  return ROUTES.find((route) => route === name) ?? 'tables';
}

/** The section of Yönetim an address names, or null when it names none this build knows. */
export function parseManageSection(hash: string): ManageSection | null {
  const [name, section] = pathOf(hash);
  if (name === OLD_REPORTS) {
    return 'reports';
  }
  if (name !== 'manage') {
    return null;
  }
  return MANAGE_SECTIONS.find((known) => known === section) ?? null;
}

export function manageAddress(section: ManageSection): string {
  return `#/manage/${section}`;
}

/** The current screen, following the address as links and the back button change it. */
export function useRoute(): Route {
  return useSyncExternalStore(subscribe, () => parseRoute(window.location.hash));
}

/** The section of Yönetim the address names, following it. */
export function useManageSection(): ManageSection | null {
  return useSyncExternalStore(subscribe, () => parseManageSection(window.location.hash));
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
