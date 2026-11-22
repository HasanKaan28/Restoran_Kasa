import type { MarketDb } from '@/data/db';
import { itemLabel, tabTitle } from '@/data/restaurant';
import type { ProductUnit, TabItemRecord } from '@/data/types';

/**
 * Which orders this device prints a slip for as they come in: none, only those handed over at
 * once (Teslim edildi), or every order sent from any device.
 */
export type SlipMode = 'off' | 'delivered' | 'all';

/** One line of the slip: the same dish ordered the same way adds up ("5 × Efes"). */
export type OrderSlipLine = {
  label: string;
  qtyMilli: number;
  unit: ProductUnit;
  /** The choices and the note, each on a line of its own under the dish. */
  details: string[];
};

/** One order as it was sent: the lines of a tab that left at the same moment. */
export type OrderSlip = {
  /** The tab and the moment it was sent; stable, for lists. */
  id: string;
  tabId: string;
  /** "Masa 5", "Paket 3". */
  title: string;
  /** Who took the lines; empty when no staff are set up or the lines predate it. */
  waiters: string[];
  /** Where the lines with no known waiter were entered: a device's name, or its code ("P1"). */
  devices: string[];
  sentAt: string;
  /** Every line was handed over at once rather than sent to the kitchen or the bar. */
  delivered: boolean;
  lines: OrderSlipLine[];
};

/** Where this device keeps the lines it has already printed (or passed over), by line and send. */
const PRINTED_KEY = 'orderSlipsPrinted';
/**
 * The newest send the record had to forget past its ceiling: nothing sent at or before it is
 * looked at again, so a forgotten line can never print twice.
 */
const FLOOR_KEY = 'orderSlipsFloor';
/** The latest slip printed, for "Son adisyonu tekrar bas". */
const LAST_KEY = 'orderSlipLast';
/** An order sent longer ago than this is never printed; the record forgets it after as long. */
const REMEMBER_MS = 24 * 60 * 60_000;
/** A ceiling for a very busy day, so the record stays small whatever happens. */
const MOST_REMEMBERED = 5_000;
/** A remake's reason longer than this stays off the printed slip. */
const MOST_REASON_CHARS = 30;

/** The oldest send still looked at: the choice's moment, or a day ago, whichever is later. */
export function slipWindowStart(since: string, now: Date): string {
  const dayAgo = new Date(now.getTime() - REMEMBER_MS).toISOString();
  return since > dayAgo ? since : dayAgo;
}

/**
 * Looks at every order line sent since printing was turned on (`since`) and within the last day
 * that this device has not looked at before, remembers them (in this market's database on the
 * device, so a reload or a fresh sync prints nothing twice) and returns the slips to print, one
 * per tab and moment sent, oldest first. A line is remembered by itself, not by its tab: a line
 * that arrives late by sync prints on a slip of its own, and one moved to another tab later is
 * not printed again. An order whose tab has not arrived yet waits for it.
 */
export async function takeNewSlips(
  db: MarketDb,
  options: {
    mode: SlipMode;
    since: string;
    now: Date;
    /** Names of devices by code, for lines with no known waiter (this device's own, say). */
    deviceNames?: Readonly<Record<string, string>>;
    /** The record's ceiling; smaller only in tests. */
    most?: number;
  },
): Promise<OrderSlip[]> {
  if (options.mode === 'off') {
    return [];
  }
  const mode = options.mode;
  return db.transaction(
    'rw',
    [db.meta, db.tabItems, db.tabs, db.diningTables, db.staff],
    async () => {
      const stored = (await db.meta.get(PRINTED_KEY))?.value;
      const printed = new Set(Array.isArray(stored) ? stored.filter(isText) : []);
      const storedFloor = (await db.meta.get(FLOOR_KEY))?.value;
      const floor = typeof storedFloor === 'string' ? storedFloor : '';
      const unseen = (
        await db.tabItems
          .where('sentAt')
          .aboveOrEqual(slipWindowStart(options.since, options.now))
          .toArray()
      ).filter((item) => (item.sentAt ?? '') > floor && !printed.has(printedKey(item)));

      const slips: OrderSlip[] = [];
      const looked: string[] = [];
      for (const lines of byOrder(unseen)) {
        const first = lines[0]!;
        const tab = await db.tabs.get(first.tabId);
        if (!tab) {
          continue;
        }
        looked.push(...lines.map(printedKey));
        const shown = lines.filter(
          (item) => item.status !== 'void' && (mode === 'all' || item.deliveredAt),
        );
        if (shown.length === 0) {
          continue;
        }
        slips.push({
          id: `${first.tabId}@${first.sentAt ?? ''}`,
          tabId: first.tabId,
          title: await tabTitle(db, tab),
          ...(await whoEntered(db, shown, options.deviceNames ?? {})),
          sentAt: first.sentAt ?? '',
          delivered: shown.every((item) => item.deliveredAt),
          lines: sumByDish(shown),
        });
      }

      const dayAgo = new Date(options.now.getTime() - REMEMBER_MS).toISOString();
      const record = remember(
        [...printed, ...looked].filter((key) => sentOf(key) >= dayAgo),
        options.most ?? MOST_REMEMBERED,
      );
      await db.meta.put({ key: PRINTED_KEY, value: record.keys });
      if (record.floor > floor) {
        await db.meta.put({ key: FLOOR_KEY, value: record.floor });
      }
      const latest = slips.at(-1);
      if (latest) {
        await db.meta.put({ key: LAST_KEY, value: latest });
      }
      return slips;
    },
  );
}

const DATE = new Intl.DateTimeFormat('tr-TR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'Europe/Istanbul',
});
const TIME = new Intl.DateTimeFormat('tr-TR', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Istanbul',
});

/** The day and the time on a slip, as the restaurant reads them: "22.11.2026", "21:05". */
export function slipDateTime(iso: string): { date: string; time: string } {
  const when = new Date(iso);
  return { date: DATE.format(when), time: TIME.format(when) };
}

/** The latest slip printed on this device, or null before the first. */
export async function lastSlip(db: MarketDb): Promise<OrderSlip | null> {
  const stored = (await db.meta.get(LAST_KEY))?.value;
  return isSlip(stored) ? stored : null;
}

/**
 * The record within its ceiling: past it, the oldest sends are forgotten whole and the newest of
 * them becomes the floor, below which nothing is looked at again.
 */
function remember(keys: string[], most: number): { keys: string[]; floor: string } {
  if (keys.length <= most) {
    return { keys, floor: '' };
  }
  const sorted = [...keys].sort((a, b) => sentOf(a).localeCompare(sentOf(b)));
  const floor = sentOf(sorted[keys.length - most - 1]!);
  return { keys: sorted.filter((key) => sentOf(key) > floor), floor };
}

function sentOf(key: string): string {
  return key.slice(key.indexOf('@') + 1);
}

function isSlip(value: unknown): value is OrderSlip {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as OrderSlip).id === 'string' &&
    Array.isArray((value as OrderSlip).lines) &&
    Array.isArray((value as OrderSlip).waiters) &&
    Array.isArray((value as OrderSlip).devices)
  );
}

/** A line sent again (a recall, a later course) has a new `sentAt`, so it is a new order. */
function printedKey(item: Pick<TabItemRecord, 'id' | 'sentAt'>): string {
  return `${item.id}@${item.sentAt ?? ''}`;
}

/** The lines of each order, the orders oldest first and each order's lines as they were taken. */
function byOrder(items: TabItemRecord[]): TabItemRecord[][] {
  const sorted = [...items].sort(
    (a, b) =>
      (a.sentAt ?? '').localeCompare(b.sentAt ?? '') ||
      a.tabId.localeCompare(b.tabId) ||
      a.orderedAt.localeCompare(b.orderedAt) ||
      a.id.localeCompare(b.id),
  );
  const orders = new Map<string, TabItemRecord[]>();
  for (const item of sorted) {
    const key = `${item.tabId}@${item.sentAt ?? ''}`;
    orders.set(key, [...(orders.get(key) ?? []), item]);
  }
  return [...orders.values()];
}

/** The waiters by name; for lines whose waiter is unknown, the device they were entered on. */
async function whoEntered(
  db: MarketDb,
  lines: TabItemRecord[],
  deviceNames: Readonly<Record<string, string>>,
): Promise<Pick<OrderSlip, 'waiters' | 'devices'>> {
  const waiters = new Set<string>();
  const devices = new Set<string>();
  for (const line of lines) {
    const person = line.staffId ? await db.staff.get(line.staffId) : undefined;
    if (person) {
      waiters.add(person.name);
    } else {
      devices.add(deviceNames[line.deviceCode] ?? line.deviceCode);
    }
  }
  return { waiters: [...waiters], devices: [...devices] };
}

function sumByDish(lines: TabItemRecord[]): OrderSlipLine[] {
  const byDish = new Map<string, OrderSlipLine>();
  for (const line of lines) {
    const label = itemLabel(line);
    const details = [
      ...(line.remakeOf ? [remakeDetail(line.remakeReason)] : []),
      ...(line.options ?? []),
      ...(line.note ? [`Not: ${line.note}`] : []),
    ];
    const key = [label, line.unit, ...details].join('\u0000');
    const found = byDish.get(key);
    byDish.set(key, {
      label,
      qtyMilli: (found?.qtyMilli ?? 0) + line.qtyMilli,
      unit: line.unit,
      details,
    });
  }
  return [...byDish.values()];
}

/** A remade line says so on the slip, with its reason when it is short enough to print. */
function remakeDetail(reason: string | undefined): string {
  const why = reason?.trim() ?? '';
  return why !== '' && why.length <= MOST_REASON_CHARS ? `Tekrar · ${why}` : 'Tekrar';
}

function isText(value: unknown): value is string {
  return typeof value === 'string';
}
