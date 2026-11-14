import { useLiveQuery } from 'dexie-react-hooks';
import { ShoppingBag } from 'lucide-react';
import { useState, type JSX } from 'react';
import { useData, useSyncStatus } from '@/app/appData';
import { AppShell } from '@/app/AppShell';
import { useSession } from '@/app/session';
import { listDiningTables, openTab, openTabs, tabBill } from '@/data/restaurant';
import type { TabRecord } from '@/data/types';
import { Button, ChoiceGroup, ToastRegion, useToast } from '@/design';
import { formatTRY } from '@/domain/money';
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
 * The floor: every table, empty or with its tab's total, how long it has been open and how many
 * lines are ready to serve; takeaway orders beside them. A tap opens the table's tab.
 */
export function TablesScreen(): JSX.Element {
  const { db, settings, runner } = useData();
  const status = useSyncStatus(runner);
  const session = useSession();
  const toast = useToast();
  const now = useNow();
  const [area, setArea] = useState(ALL);
  const [openId, setOpenId] = useState<string | null>(null);

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
    return <TabView tabId={openId} onClose={() => setOpenId(null)} />;
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
    setOpenId(tab.id);
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
        {floor && floor.seated.length === 0 ? (
          <p className="rounded-control border border-line bg-surface p-5 text-text-2">
            Henüz masa yok. Ayarlar → Masalar bölümünden masa ekleyin; paket siparişler masasız da
            alınır.
          </p>
        ) : null}
        <ul
          aria-label="Masalar"
          className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-3"
        >
          {shown.map((table) => {
            const busy = table.tab !== undefined;
            const minutes = table.tab ? minutesSince(table.tab.openedAt, now) : 0;
            return (
              <li key={table.id}>
                <button
                  type="button"
                  onClick={() => void open(table.id)}
                  aria-label={`${table.name}, ${busy ? `dolu, ${formatTRY(table.total)}` : 'boş'}`}
                  className={`flex min-h-28 w-full flex-col justify-between rounded-control border p-3 text-left ${
                    busy ? 'border-accent bg-accent/10' : 'border-line bg-surface hover:bg-bg'
                  } ${table.ready > 0 ? 'ring-2 ring-success' : ''}`}
                >
                  <span className="text-lg font-semibold">{table.name}</span>
                  {busy ? (
                    <span className="flex flex-col text-sm">
                      <span className="font-mono text-base font-semibold">
                        {formatTRY(table.total)}
                      </span>
                      <span className="text-text-2">{`${minutes} dk`}</span>
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
                  <Button onClick={() => setOpenId(tab.id)}>
                    {`${tab.label ?? 'Paket'} · ${formatTRY(total)}${ready > 0 ? ` · ${ready} hazır` : ''}`}
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </AppShell>
      <ToastRegion message={toast.message} />
    </>
  );
}
