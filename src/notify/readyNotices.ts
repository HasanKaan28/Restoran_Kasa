import type { MarketDb } from '@/data/db';
import { itemLabel, tabTitle } from '@/data/restaurant';
import type { ProductUnit, TabItemRecord } from '@/data/types';
import { formatLineQty } from '@/pos/format';

/** The device that would hear of a ready line, and who is signed in on it (null: nobody, or no staff). */
export type Listener = { deviceCode: string; staffId: string | null };

/** What one table's (or takeaway order's) station has just made ready, said once. */
export type ReadyNotice = {
  /** Stable for the same lines, so a repeated system notification replaces the first. */
  id: string;
  tabId: string;
  /** "Masa 5", "Paket 3". */
  title: string;
  station: 'kitchen' | 'bar';
  lines: { label: string; qtyMilli: number; unit: ProductUnit }[];
  itemIds: string[];
};

export const STATION_LABELS: Record<ReadyNotice['station'], string> = {
  kitchen: 'Mutfak',
  bar: 'Bar',
};

/** Where this device keeps the ready lines it has already looked at. */
const ANNOUNCED_KEY = 'readyAnnounced';
/** A line ready longer ago than this passes without a word: the waiter has surely seen it. */
const FRESH_MS = 10 * 60_000;
/** How long a looked-at line is remembered; long enough for any line still on a tab. */
const REMEMBER_MS = 24 * 60 * 60_000;

/**
 * Whether a line is the listener's own order: the waiter who took it is signed in here, wherever
 * they took it. With nobody signed in here, or a line taken with no staff set up, the device that
 * took it hears of it.
 */
export function isMine(line: Pick<TabItemRecord, 'deviceCode' | 'staffId'>, me: Listener): boolean {
  if (me.staffId !== null && line.staffId) {
    return line.staffId === me.staffId;
  }
  return line.deviceCode === me.deviceCode;
}

/**
 * Looks at every ready line this device has not looked at before, remembers them all (in this
 * market's database on the device, so a reload repeats nothing), and returns those to announce,
 * grouped. Not announced: lines made ready on this device, lines that needed no preparing, lines
 * not the listener's own when `scope` is `mine`, lines ready long ago, and everything on the first
 * run or while `quiet` (a kitchen screen, notifications off).
 */
export async function takeReadyNews(
  db: MarketDb,
  me: Listener,
  options: { scope: 'mine' | 'all'; quiet: boolean; now: Date },
): Promise<ReadyNotice[]> {
  return db.transaction('rw', [db.meta, db.tabItems, db.tabs, db.diningTables], async () => {
    const stored = (await db.meta.get(ANNOUNCED_KEY))?.value;
    const announced = new Set(Array.isArray(stored) ? stored.filter(isText) : []);
    const ready = await db.tabItems.where('status').equals('ready').toArray();
    const unseen = ready.filter((item) => item.readyAt && !announced.has(announceKey(item)));
    const now = options.now.getTime();
    const news =
      options.quiet || stored === undefined
        ? []
        : unseen.filter(
            (item) =>
              isNews(item, me, options.scope) && now - Date.parse(item.readyAt ?? '') <= FRESH_MS,
          );

    const remembered = [...announced].filter(
      (key) => now - Date.parse(key.slice(key.indexOf('@') + 1)) <= REMEMBER_MS,
    );
    await db.meta.put({
      key: ANNOUNCED_KEY,
      value: [...remembered, ...unseen.map(announceKey)],
    });
    return groupNotices(db, news);
  });
}

/** What a notice says: its heading, its lines, and both as one sentence for the banner. */
export function noticeText(notice: ReadyNotice): { title: string; body: string; sentence: string } {
  const title = `${notice.title} hazır`;
  const body = notice.lines
    .map((line) => `${formatLineQty(line.qtyMilli, line.unit)} × ${line.label}`)
    .join(', ');
  return { title, body, sentence: `${title}: ${body}` };
}

/** A line marked ready again after a recall has a new `readyAt`, so it is news again. */
function announceKey(item: Pick<TabItemRecord, 'id' | 'readyAt'>): string {
  return `${item.id}@${item.readyAt ?? ''}`;
}

function isNews(item: TabItemRecord, me: Listener, scope: 'mine' | 'all'): boolean {
  return (
    item.station !== 'none' &&
    !item.servedAt &&
    !item.paidSaleId &&
    item.readyDeviceCode !== me.deviceCode &&
    (scope === 'all' || isMine(item, me))
  );
}

/** One notice per tab and station, oldest first (the kitchen's before the bar's at the same moment); the same dish's lines add up ("2 × Adana kebap"). */
async function groupNotices(db: MarketDb, items: TabItemRecord[]): Promise<ReadyNotice[]> {
  const sorted = [...items].sort(
    (a, b) =>
      (a.readyAt ?? '').localeCompare(b.readyAt ?? '') ||
      Number(a.station === 'bar') - Number(b.station === 'bar') ||
      a.orderedAt.localeCompare(b.orderedAt) ||
      a.id.localeCompare(b.id),
  );
  const groups = new Map<string, TabItemRecord[]>();
  for (const item of sorted) {
    const key = `${item.tabId}:${item.station}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const notices: ReadyNotice[] = [];
  for (const [key, lines] of groups) {
    const first = lines[0]!;
    const tab = await db.tabs.get(first.tabId);
    if (!tab) {
      continue;
    }
    notices.push({
      id: `${key}:${first.readyAt ?? ''}`,
      tabId: first.tabId,
      title: await tabTitle(db, tab),
      station: first.station === 'bar' ? 'bar' : 'kitchen',
      lines: sumByDish(lines),
      itemIds: lines.map((line) => line.id),
    });
  }
  return notices;
}

function sumByDish(lines: TabItemRecord[]): ReadyNotice['lines'] {
  const byDish = new Map<string, ReadyNotice['lines'][number]>();
  for (const line of lines) {
    const label = itemLabel(line);
    const key = `${label}\u0000${line.unit}`;
    const found = byDish.get(key);
    byDish.set(key, {
      label,
      unit: line.unit,
      qtyMilli: (found?.qtyMilli ?? 0) + line.qtyMilli,
    });
  }
  return [...byDish.values()];
}

function isText(value: unknown): value is string {
  return typeof value === 'string';
}
