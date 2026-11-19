import { useLiveQuery } from 'dexie-react-hooks';
import { LayoutGrid, ShoppingBag } from 'lucide-react';
import { useRef, useState, type JSX } from 'react';
import { useData, useSyncStatus } from '@/app/appData';
import { AppShell } from '@/app/AppShell';
import { leaveTabScreen, openTabScreen, useTabId } from '@/app/route';
import { useSession } from '@/app/session';
import {
  cancelBillRequest,
  listDiningTables,
  openTab,
  openTabs,
  requestBill,
  tabBill,
} from '@/data/restaurant';
import type { TabRecord } from '@/data/types';
import { Button, ChoiceGroup, Dialog, EmptyState, ToastRegion, useToast } from '@/design';
import { formatTRY } from '@/domain/money';
import { MoveDialog } from './MoveDialog';
import { PayDialog } from './PayDialog';
import { SetupChecklist } from './SetupChecklist';
import { TabView } from './TabView';
import { minutesSince, useNow } from './time';

const ALL = '';

type FloorTable = {
  id: string;
  name: string;
  area: string;
  tab?: TabRecord;
  total: number;
  ready: number;
};

/**
 * The floor: every table, empty or with its tab's total, how long it has been open, how many
 * lines are ready to serve and whether the bill was asked for; takeaway orders beside them. A
 * tap opens the table's tab; a long press (or a right click) offers its actions without it.
 */
export function TablesScreen(): JSX.Element {
  const { db, settings, runner } = useData();
  const status = useSyncStatus(runner);
  const session = useSession();
  const toast = useToast();
  const now = useNow();
  const [area, setArea] = useState(ALL);
  const openId = useTabId();
  const [actions, setActions] = useState<FloorTable | null>(null);
  const [tabDialog, setTabDialog] = useState<{ kind: 'pay' | 'move'; tabId: string } | null>(null);
  const pressTimer = useRef<number | undefined>(undefined);
  const longPressed = useRef(false);

  const floor = useLiveQuery(async () => {
    const [tables, tabs] = await Promise.all([listDiningTables(db), openTabs(db)]);
    const totals = new Map<string, { total: number; ready: number }>();
    for (const tab of tabs) {
      const bill = await tabBill(db, tab.id);
      const ready = bill.lines.filter((line) => line.item.status === 'ready').length;
      totals.set(tab.id, { total: bill.total, ready });
    }
    const seated: FloorTable[] = tables.map((table) => {
      const tab = tabs.find((open) => open.tableId === table.id);
      const sums = tab ? totals.get(tab.id) : undefined;
      return {
        id: table.id,
        name: table.name,
        area: table.area,
        ...(tab ? { tab } : {}),
        total: sums?.total ?? 0,
        ready: sums?.ready ?? 0,
      };
    });
    const takeaway = tabs
      .filter((tab) => tab.tableId === undefined)
      .map((tab) => ({ tab, ...(totals.get(tab.id) ?? { total: 0, ready: 0 }) }));
    return { seated, takeaway };
  }, [db]);

  if (openId) {
    return <TabView tabId={openId} onClose={leaveTabScreen} />;
  }

  // A press held half a second opens the table's actions instead of the tab.
  function pressStart(table: FloorTable) {
    longPressed.current = false;
    window.clearTimeout(pressTimer.current);
    pressTimer.current = window.setTimeout(() => {
      longPressed.current = true;
      setActions(table);
    }, 500);
  }
  function pressEnd() {
    window.clearTimeout(pressTimer.current);
  }

  async function toggleBill(tab: TabRecord) {
    if (tab.billRequestedAt) {
      await cancelBillRequest(db, tab.id, new Date());
      toast.show('Siparişe açıldı.');
    } else {
      await requestBill(db, tab.id, new Date());
      toast.show('Hesap istendi.');
    }
    setActions(null);
    void runner.run();
  }

  const areas = [...new Set((floor?.seated ?? []).map((table) => table.area))];
  const shown = (floor?.seated ?? []).filter((table) => area === ALL || table.area === area);
  const waiter = { deviceCode: settings.deviceCode, staffId: session.staff?.id };

  async function open(tableId?: string) {
    const takeawayCount = floor?.takeaway.length ?? 0;
    const tab = await openTab(
      db,
      tableId ? { tableId, ...waiter } : { label: `Paket ${takeawayCount + 1}`, ...waiter },
      new Date(),
    );
    openTabScreen(tab.id);
  }

  return (
    <>
      <AppShell
        marketName={settings.marketName}
        deviceName={settings.deviceName}
        syncState={status.state}
        pendingCount={status.pendingCount}
        syncError={status.error}
        activeNav="tables"
      >
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="mr-auto text-xl font-semibold">Masalar</h1>
          <Button
            icon={<ShoppingBag aria-hidden="true" size={18} />}
            onClick={() => void open().catch(() => toast.show('Paket sipariş açılamadı.'))}
          >
            Paket sipariş
          </Button>
        </div>
        {areas.length > 1 ? (
          <ChoiceGroup<string>
            legend="Bölüm"
            name="area"
            wrap
            options={[
              { value: ALL, label: 'Tümü' },
              ...areas.map((name) => ({ value: name, label: name })),
            ]}
            value={area}
            onChange={setArea}
          />
        ) : null}
        {session.can('admin') ? <SetupChecklist /> : null}
        {floor && floor.seated.length === 0 ? (
          <EmptyState
            icon={<LayoutGrid size={26} strokeWidth={1.75} />}
            title="Henüz masa yok"
            action={
              session.can('admin') ? (
                <a
                  href="#/settings/masalar"
                  className="inline-flex min-h-touch items-center justify-center rounded-control bg-accent px-5 font-semibold text-on-accent no-underline hover:bg-accent-hover"
                >
                  Masaları ekle
                </a>
              ) : null
            }
          >
            {session.can('admin')
              ? 'Masaları ekleyince burada salonunuz gibi dizilir. Paket siparişler masasız da alınır.'
              : 'Masaları yöneticiniz Ayarlar’dan ekler. Paket siparişler masasız da alınır.'}
          </EmptyState>
        ) : null}
        <ul
          aria-label="Masalar"
          className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-3"
        >
          {shown.map((table) => {
            const busy = table.tab !== undefined;
            const minutes = table.tab ? minutesSince(table.tab.openedAt, now) : 0;
            const billAsked = table.tab?.billRequestedAt !== undefined;
            return (
              <li key={table.id}>
                <button
                  type="button"
                  onClick={() => {
                    if (!longPressed.current) {
                      void open(table.id);
                    }
                    longPressed.current = false;
                  }}
                  onPointerDown={() => pressStart(table)}
                  onPointerUp={pressEnd}
                  onPointerLeave={pressEnd}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    pressEnd();
                    setActions(table);
                  }}
                  aria-label={`${table.name}, ${
                    busy
                      ? `${billAsked ? 'hesap istendi' : 'dolu'}, ${formatTRY(table.total)}`
                      : 'boş'
                  }`}
                  className={`slip flex min-h-28 w-full touch-manipulation flex-col justify-between p-3 text-left transition-transform select-none active:scale-[0.98] ${
                    billAsked
                      ? 'edge-bill bg-warning-bg'
                      : table.ready > 0
                        ? 'edge-ready bg-accent/10'
                        : busy
                          ? 'edge-open bg-accent/10'
                          : 'edge-quiet hover:bg-bg'
                  }`}
                >
                  <span className="font-display text-2xl leading-none font-bold tracking-[-0.02em]">
                    {table.name}
                  </span>
                  {busy ? (
                    <span className="flex flex-col text-sm">
                      <span className="font-display text-base font-semibold">
                        {formatTRY(table.total)}
                      </span>
                      <span className="text-text-2">{`${minutes} dk`}</span>
                      {billAsked ? (
                        <span className="font-medium text-warning">Hesap istendi</span>
                      ) : null}
                      {table.ready > 0 ? (
                        <span className="font-medium text-success">{`${table.ready} hazır`}</span>
                      ) : null}
                    </span>
                  ) : (
                    <span className="text-sm text-text-2">Boş</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
        {floor && floor.takeaway.length > 0 ? (
          <section aria-labelledby="takeaway-heading" className="flex flex-col gap-2">
            <h2 id="takeaway-heading" className="text-lg font-semibold">
              Paket siparişler
            </h2>
            <ul className="flex flex-wrap gap-2">
              {floor.takeaway.map(({ tab, total, ready }) => (
                <li key={tab.id}>
                  <Button onClick={() => openTabScreen(tab.id)}>
                    {`${tab.label ?? 'Paket'} · ${formatTRY(total)}${ready > 0 ? ` · ${ready} hazır` : ''}`}
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </AppShell>
      {actions ? (
        <Dialog
          open
          onOpenChange={(next) => !next && setActions(null)}
          title={actions.tab ? `${actions.name} · ${formatTRY(actions.total)}` : actions.name}
        >
          <div className="flex flex-col gap-2">
            <Button
              variant="primary"
              onClick={() => {
                setActions(null);
                void open(actions.id);
              }}
            >
              {actions.tab ? 'Adisyonu aç' : 'Masayı aç'}
            </Button>
            {actions.tab ? (
              <>
                <Button onClick={() => void toggleBill(actions.tab as TabRecord)}>
                  {actions.tab.billRequestedAt ? 'Siparişe aç' : 'Hesap iste'}
                </Button>
                <Button
                  disabled={!session.can('sell')}
                  onClick={() => {
                    setTabDialog({ kind: 'pay', tabId: (actions.tab as TabRecord).id });
                    setActions(null);
                  }}
                >
                  Hesap al
                </Button>
                <Button
                  onClick={() => {
                    setTabDialog({ kind: 'move', tabId: (actions.tab as TabRecord).id });
                    setActions(null);
                  }}
                >
                  Taşı / birleştir
                </Button>
              </>
            ) : null}
          </div>
        </Dialog>
      ) : null}
      {tabDialog?.kind === 'pay' ? (
        <PayDialog
          tabId={tabDialog.tabId}
          onClose={() => setTabDialog(null)}
          onPaid={(message) => {
            setTabDialog(null);
            toast.show(message);
            void runner.run();
          }}
        />
      ) : null}
      {tabDialog?.kind === 'move' ? (
        <MoveDialog
          tabId={tabDialog.tabId}
          onClose={() => setTabDialog(null)}
          onMoved={(message) => {
            setTabDialog(null);
            toast.show(message);
            void runner.run();
          }}
        />
      ) : null}
      <ToastRegion message={toast.message} />
    </>
  );
}
