import { useLiveQuery } from 'dexie-react-hooks';
import { useState, type JSX } from 'react';
import { useData, useSyncStatus } from '@/app/appData';
import { AppShell } from '@/app/AppShell';
import { kitchenTickets, markReady } from '@/data/restaurant';
import type { Station } from '@/data/types';
import { Button, ChoiceGroup } from '@/design';
import { formatLineQty } from '@/pos/format';
import { minutesSince, useNow } from './time';

const STATIONS: readonly { value: Exclude<Station, 'none'>; label: string }[] = [
  { value: 'kitchen', label: 'Mutfak' },
  { value: 'bar', label: 'Bar' },
];

const STATION_KEY = 'rk.station';
/** A ticket waiting this long turns red. */
const LATE_MINUTES = 15;

function storedStation(): Exclude<Station, 'none'> {
  try {
    return localStorage.getItem(STATION_KEY) === 'bar' ? 'bar' : 'kitchen';
  } catch {
    return 'kitchen';
  }
}

/**
 * The kitchen's or the bar's screen: one ticket per table with what is still to prepare, the
 * longest waiting first. A tap on a line marks it ready, and the waiter's screen shows it.
 * Each device remembers which station it is.
 */
export function KitchenScreen(): JSX.Element {
  const { db, settings, runner } = useData();
  const status = useSyncStatus(runner);
  const now = useNow(15_000);
  const [station, setStation] = useState(storedStation);
  const tickets = useLiveQuery(() => kitchenTickets(db, station), [db, station]);

  function choose(next: Exclude<Station, 'none'>) {
    setStation(next);
    try {
      localStorage.setItem(STATION_KEY, next);
    } catch {
      // Without storage the choice lasts for this session.
    }
  }

  async function ready(ids: string[]) {
    await markReady(db, ids, new Date());
    void runner.run();
  }

  return (
    <AppShell
      marketName={settings.marketName}
      deviceName={settings.deviceName}
      syncState={status.state}
      pendingCount={status.pendingCount}
      syncError={status.error}
      activeNav="kitchen"
    >
      <div className="flex flex-wrap items-end gap-3">
        <h1 className="mr-auto text-xl font-semibold">{station === 'bar' ? 'Bar' : 'Mutfak'}</h1>
        <div className="w-64">
          <ChoiceGroup<Exclude<Station, 'none'>>
            legend="Bu ekran"
            name="station"
            options={STATIONS}
            value={station}
            onChange={choose}
          />
        </div>
      </div>
      {tickets && tickets.length === 0 ? (
        <p className="rounded-control border border-line bg-surface p-5 text-text-2">
          Bekleyen sipariş yok.
        </p>
      ) : null}
      <ul
        aria-label="Siparişler"
        className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-3"
      >
        {(tickets ?? []).map((ticket) => {
          const minutes = minutesSince(ticket.sentAt, now);
          const late = minutes >= LATE_MINUTES;
          return (
            <li
              key={ticket.tab.id}
              aria-label={ticket.title}
              className={`flex flex-col gap-2 rounded-control border bg-surface p-3 ${late ? 'border-danger' : 'border-line'}`}
            >
              <div className="flex items-baseline justify-between">
                <span className="text-xl font-semibold">{ticket.title}</span>
                <span className={late ? 'font-semibold text-danger' : 'text-text-2'}>
                  {`${minutes} dk`}
                </span>
              </div>
              <ul className="flex flex-col gap-1">
                {ticket.items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      aria-label={`Hazır: ${item.name}`}
                      onClick={() => void ready([item.id])}
                      className="flex w-full flex-col rounded-control border border-line px-3 py-2 text-left hover:bg-bg"
                    >
                      <span className="text-lg font-medium">
                        {`${formatLineQty(item.qtyMilli, item.unit)} × ${item.name}`}
                      </span>
                      {item.note ? (
                        <span className="font-medium text-accent">{item.note}</span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
              <Button
                variant="primary"
                onClick={() => void ready(ticket.items.map((item) => item.id))}
              >
                Hepsi hazır
              </Button>
            </li>
          );
        })}
      </ul>
    </AppShell>
  );
}
