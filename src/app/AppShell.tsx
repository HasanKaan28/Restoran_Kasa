import { Lock } from 'lucide-react';
import type { JSX, ReactNode } from 'react';
import { Button, Logo } from '@/design';
import type { SyncState } from '@/sync/runner';
import { LicenseBanner } from './LicenseBanner';
import { ROUTE_PERMISSIONS, type Route } from './route';
import { useSession } from './session';
import { APP_VERSION } from './version';

/** A screen's menu key; the market screens still in the code base name theirs, unlisted here. */
export type NavKey = Route | 'pos' | 'stock' | 'customers' | 'suppliers' | 'invoices';

export type AppShellProps = {
  marketName: string;
  deviceName: string;
  staffName?: string;
  syncState: SyncState;
  pendingCount?: number;
  /** Why the last sync failed, shown instead of the generic error label. */
  syncError?: string;
  activeNav: NavKey;
  children?: ReactNode;
  /** The register's cart; screens without one get the full width. */
  cart?: ReactNode;
};

// Only screens that exist are listed; each later milestone adds its own.
const NAV_ITEMS: readonly { key: Route; label: string }[] = [
  { key: 'tables', label: 'Masalar' },
  { key: 'kitchen', label: 'Mutfak / Bar' },
  { key: 'products', label: 'Menü' },
  { key: 'reports', label: 'Raporlar' },
  { key: 'settings', label: 'Ayarlar' },
];

export function AppShell({
  marketName,
  deviceName,
  staffName,
  syncState,
  pendingCount = 0,
  syncError,
  activeNav,
  children,
  cart,
}: AppShellProps): JSX.Element {
  const session = useSession();
  const shownStaff = staffName ?? session.staff?.name;
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-line bg-surface px-5 py-2.5">
        <div className="flex items-center gap-3">
          <Logo />
          <div className="flex flex-col leading-tight">
            <span className="text-[15px] font-semibold">{marketName}</span>
            <span className="text-sm text-muted">{deviceName}</span>
          </div>
        </div>
        {/* On a phone the menu is one row that scrolls sideways, not four rows over the screen. */}
        <nav
          aria-label="Ana menü"
          className="-mx-5 flex w-[calc(100%+2.5rem)] gap-1 overflow-x-auto px-5 whitespace-nowrap [scrollbar-width:none] md:mx-0 md:w-auto md:flex-wrap md:overflow-visible md:px-0"
        >
          {NAV_ITEMS.filter((item) => {
            const needed = ROUTE_PERMISSIONS[item.key];
            return needed === undefined || session.can(needed);
          }).map((item) => (
            <NavLink key={item.key} navKey={item.key} active={item.key === activeNav}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto flex flex-wrap items-center gap-4">
          <SyncBadge state={syncState} pendingCount={pendingCount} error={syncError} />
          {shownStaff ? <span className="text-sm text-text-2">{shownStaff}</span> : null}
          {session.staff ? (
            <Button
              variant="ghost"
              icon={<Lock aria-hidden="true" size={18} />}
              onClick={session.signOut}
            >
              Kilitle
            </Button>
          ) : null}
        </div>
      </header>
      <LicenseBanner />

      <div className="flex flex-1 flex-wrap gap-4 px-5 py-4">
        <main className="flex min-w-0 flex-[999_1_560px] flex-col gap-3.5">{children}</main>
        {cart ? (
          <aside
            aria-label="Sepet"
            className="flex max-w-[460px] flex-[1_1_380px] flex-col rounded-control border border-line bg-surface"
          >
            {cart}
          </aside>
        ) : null}
      </div>

      <footer className="px-5 pb-3 text-sm text-muted">{`v${APP_VERSION}`}</footer>
    </div>
  );
}

function NavLink({
  navKey,
  active,
  children,
}: {
  navKey: NavKey;
  active: boolean;
  children: ReactNode;
}): JSX.Element {
  const stateClasses = active ? 'bg-bg font-semibold text-text' : 'text-text-2 hover:bg-bg';
  return (
    <a
      href={`#/${navKey}`}
      aria-current={active ? 'page' : undefined}
      className={`inline-flex min-h-11 items-center rounded-control px-3.5 no-underline ${stateClasses}`}
    >
      {children}
    </a>
  );
}

const SYNC_STYLES: Record<SyncState, { dot: string; text: string }> = {
  online: { dot: 'bg-success', text: 'text-success' },
  offline: { dot: 'bg-muted', text: 'text-text-2' },
  pending: { dot: 'bg-accent', text: 'text-accent' },
  error: { dot: 'bg-danger', text: 'text-danger' },
};

function SyncBadge({
  state,
  pendingCount,
  error,
}: {
  state: SyncState;
  pendingCount: number;
  error?: string;
}): JSX.Element {
  const queued = pendingCount > 0 ? `${pendingCount} işlem bekliyor` : undefined;
  const label = {
    online: 'Çevrimiçi',
    offline: queued ? `Çevrimdışı · ${queued}` : 'Çevrimdışı',
    pending: queued ?? 'Eşitleniyor',
    error: error ?? 'Eşitleme hatası',
  }[state];
  const style = SYNC_STYLES[state];
  return (
    <span
      role="status"
      className={`inline-flex items-center gap-2 rounded-full border border-line px-3 py-1.5 text-sm ${style.text}`}
    >
      <span aria-hidden="true" className={`size-2 rounded-full ${style.dot}`} />
      {label}
    </span>
  );
}
