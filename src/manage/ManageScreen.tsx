import { useEffect, useRef, type JSX } from 'react';
import { useData, useSyncStatus } from '@/app/appData';
import { AppShell } from '@/app/AppShell';
import { NoAccessNote } from '@/app/NoAccessNote';
import {
  MANAGE_SECTIONS,
  manageAddress,
  SECTION_ACCESS,
  useManageSection,
  type ManageSection,
} from '@/app/route';
import { useSession } from '@/app/session';
import { ArchiveSection } from './ArchiveSection';
import { CreditSection } from './CreditSection';
import { ReportsSection } from './ReportsSection';
import { StaffSection } from './StaffSection';
import { StockSection } from './StockSection';
import { SuppliersSection } from './SuppliersSection';

const SECTION_LABELS: Record<ManageSection, string> = {
  reports: 'Raporlar',
  staff: 'Personel',
  credit: 'Veresiye',
  stock: 'Stok',
  suppliers: 'Tedarikçi / Fatura',
  archive: 'Arşiv',
};

/**
 * Yönetim: the owner's sections (reports, staff, credit, stock, suppliers, the archive), each at
 * its own address, and of them only those the person signed in may open. Without a section in
 * the address it opens the first of those.
 */
export function ManageScreen(): JSX.Element {
  const { settings, runner } = useData();
  const status = useSyncStatus(runner);
  const session = useSession();
  const section = useManageSection();
  const permitted = MANAGE_SECTIONS.filter((each) => SECTION_ACCESS[each](session.can));
  const first = permitted[0];

  useEffect(() => {
    if (section === null && first !== undefined) {
      showSection(first);
    }
  }, [section, first]);

  return (
    <AppShell
      marketName={settings.marketName}
      deviceName={settings.deviceName}
      syncState={status.state}
      pendingCount={status.pendingCount}
      syncError={status.error}
      activeNav="manage"
    >
      <h1 className="text-xl font-semibold">Yönetim</h1>
      <SectionTabs sections={permitted} current={section} />
      {section === null ? null : permitted.includes(section) ? (
        <SectionBody section={section} />
      ) : (
        <NoAccessNote />
      )}
    </AppShell>
  );
}

/** Puts a section in the address in place of Yönetim's bare one, so back leaves Yönetim. */
function showSection(section: ManageSection): void {
  window.history.replaceState(null, '', manageAddress(section));
  window.dispatchEvent(new Event('hashchange'));
}

/** The sections as links; on a phone the row scrolls inside itself, never the page. */
function SectionTabs({
  sections,
  current,
}: {
  sections: readonly ManageSection[];
  current: ManageSection | null;
}): JSX.Element {
  const stripRef = useRef<HTMLElement>(null);
  const activeRef = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (stripRef.current && activeRef.current) {
      revealInStrip(stripRef.current, activeRef.current);
    }
  }, [current]);
  return (
    <nav
      ref={stripRef}
      aria-label="Yönetim bölümleri"
      className="-mx-4 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:px-0"
    >
      <ul className="flex gap-2">
        {sections.map((section) => {
          const active = section === current;
          return (
            <li key={section} className="shrink-0">
              <a
                ref={active ? activeRef : undefined}
                href={manageAddress(section)}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-11 items-center justify-center rounded-chip border px-4 font-medium whitespace-nowrap no-underline transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                  active
                    ? 'border-text bg-text text-bg'
                    : 'border-line-strong bg-surface text-text-2 hover:text-text'
                }`}
              >
                {SECTION_LABELS[section]}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Scrolls the strip, not the page, so the open section's tab is in sight (a typed address). */
function revealInStrip(strip: HTMLElement, tab: HTMLElement): void {
  const box = strip.getBoundingClientRect();
  const shown = tab.getBoundingClientRect();
  if (shown.left < box.left || shown.right > box.right) {
    strip.scrollLeft += shown.left - box.left - STRIP_GUTTER;
  }
}

/** The strip's own side padding (px-4), kept before the tab it scrolls to. */
const STRIP_GUTTER = 16;

function SectionBody({ section }: { section: ManageSection }): JSX.Element {
  switch (section) {
    case 'reports':
      return <ReportsSection />;
    case 'staff':
      return <StaffSection />;
    case 'credit':
      return <CreditSection />;
    case 'stock':
      return <StockSection />;
    case 'suppliers':
      return <SuppliersSection />;
    case 'archive':
      return <ArchiveSection />;
  }
}
