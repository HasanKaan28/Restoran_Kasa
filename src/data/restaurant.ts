import { assertSafeInteger, type Kurus } from '@/domain/money';
import { computeCart, lineTotal } from '@/domain/pricing';
import type { MarketDb } from './db';
import { RecordNotFoundError } from './errors';
import { newId } from './ids';
import { appendOutbox } from './outbox';
import { withoutUndefined } from './records';
import { recordSale } from './sales';
import type {
  DiningTableRecord,
  Payment,
  ProductRecord,
  SaleRecord,
  Station,
  TabItemRecord,
  TabRecord,
} from './types';

type Waiter = { deviceCode: string; staffId?: string };

const byName = new Intl.Collator('tr', { numeric: true });

// --- Tables -------------------------------------------------------------------------------------

export async function createDiningTable(
  db: MarketDb,
  input: { name: string; area: string },
  at: Date,
): Promise<DiningTableRecord> {
  const name = input.name.trim();
  const area = input.area.trim() || 'Salon';
  if (name === '' || name.length > 30) {
    throw new RangeError('A table needs a name of 1 to 30 characters');
  }
  const stamp = at.toISOString();
  return db.transaction('rw', db.diningTables, db.outbox, async () => {
    const sort = (await db.diningTables.count()) + 1;
    const record: DiningTableRecord = {
      id: newId(at.getTime()),
      name,
      area,
      sort,
      createdAt: stamp,
      updatedAt: stamp,
    };
    await db.diningTables.add(record);
    await appendOutbox(
      db,
      { kind: 'insert', table: 'diningTables', recordId: record.id, record },
      at,
    );
    return record;
  });
}

export async function renameDiningTable(
  db: MarketDb,
  id: string,
  input: { name: string; area: string },
  at: Date,
): Promise<void> {
  const name = input.name.trim();
  const area = input.area.trim() || 'Salon';
  if (name === '' || name.length > 30) {
    throw new RangeError('A table needs a name of 1 to 30 characters');
  }
  await patch(db, 'diningTables', id, { name, area }, at);
}

/** A table taken out of use keeps its past tabs; it no longer shows on the floor. */
export async function archiveDiningTable(db: MarketDb, id: string, at: Date): Promise<void> {
  await patch(db, 'diningTables', id, { archivedAt: at.toISOString() }, at);
}

/** The tables in use, area by area in the order the areas were first added, then by addition. */
export async function listDiningTables(db: MarketDb): Promise<DiningTableRecord[]> {
  const tables = await db.diningTables.filter((table) => !table.archivedAt).toArray();
  const firstOf = new Map<string, number>();
  for (const table of tables) {
    firstOf.set(table.area, Math.min(firstOf.get(table.area) ?? Infinity, table.sort));
  }
  return tables.sort(
    (a, b) =>
      (firstOf.get(a.area) ?? 0) - (firstOf.get(b.area) ?? 0) ||
      byName.compare(a.area, b.area) ||
      a.sort - b.sort,
  );
}

// --- Tabs ---------------------------------------------------------------------------------------

/** The table's open tab, or a new one; a takeaway order (no table) always gets a new tab. */
export async function openTab(
  db: MarketDb,
  input: Waiter & { tableId?: string; label?: string; guests?: number },
  at: Date,
): Promise<TabRecord> {
  return db.transaction('rw', db.tabs, db.diningTables, db.outbox, async () => {
    if (input.tableId !== undefined) {
      const table = await db.diningTables.get(input.tableId);
      if (!table || table.archivedAt) {
        throw new RecordNotFoundError('DiningTable', input.tableId);
      }
      const open = await openTabAt(db, input.tableId);
      if (open) {
        return open;
      }
    }
    const stamp = at.toISOString();
    const record: TabRecord = withoutUndefined({
      id: newId(at.getTime()),
      tableId: input.tableId,
      label: input.tableId === undefined ? input.label?.trim() || 'Paket' : undefined,
      status: 'open' as const,
      guests: input.guests,
      deviceCode: input.deviceCode,
      staffId: input.staffId,
      openedAt: stamp,
      createdAt: stamp,
      updatedAt: stamp,
    });
    await db.tabs.add(record);
    await appendOutbox(db, { kind: 'insert', table: 'tabs', recordId: record.id, record }, at);
    return record;
  });
}

/** Every open tab, the oldest first. */
export async function openTabs(db: MarketDb): Promise<TabRecord[]> {
  const tabs = await db.tabs.where('status').equals('open').toArray();
  return tabs.sort((a, b) => a.openedAt.localeCompare(b.openedAt));
}

async function openTabAt(db: MarketDb, tableId: string): Promise<TabRecord | undefined> {
  const tabs = await db.tabs.where('tableId').equals(tableId).toArray();
  return tabs.find((tab) => tab.status === 'open');
}

/** Moves a tab to a table with no open tab of its own. */
export async function moveTab(
  db: MarketDb,
  tabId: string,
  tableId: string,
  at: Date,
): Promise<void> {
  await db.transaction('rw', db.tabs, db.diningTables, db.outbox, async () => {
    const tab = await requireOpenTab(db, tabId);
    const table = await db.diningTables.get(tableId);
    if (!table || table.archivedAt) {
      throw new RecordNotFoundError('DiningTable', tableId);
    }
    const there = await openTabAt(db, tableId);
    if (there && there.id !== tab.id) {
      throw new RangeError('That table has a tab open: merge them instead');
    }
    await patch(db, 'tabs', tabId, { tableId, label: null }, at);
  });
}

/** Moves every line of one tab onto another and closes the first as merged. */
export async function mergeTabs(
  db: MarketDb,
  fromTabId: string,
  intoTabId: string,
  at: Date,
): Promise<void> {
  if (fromTabId === intoTabId) {
    throw new RangeError('A tab cannot be merged into itself');
  }
  await db.transaction('rw', db.tabs, db.tabItems, db.outbox, async () => {
    await requireOpenTab(db, fromTabId);
    await requireOpenTab(db, intoTabId);
    for (const item of await db.tabItems.where('tabId').equals(fromTabId).toArray()) {
      if (!item.paidSaleId) {
        await patch(db, 'tabItems', item.id, { tabId: intoTabId }, at);
      }
    }
    await patch(db, 'tabs', fromTabId, { status: 'merged', closedAt: at.toISOString() }, at);
  });
}

// --- Order lines --------------------------------------------------------------------------------

export function stationOf(product: Pick<ProductRecord, 'station'>): Station {
  return product.station ?? 'kitchen';
}

export type OrderInput = {
  qtyMilli: number;
  note?: string;
  /** A portion the dish has; the plain one when absent. */
  portion?: string;
  /** Choices from the dish's groups; every required group needs one. */
  options?: readonly string[];
  /** Keep it back to fire later (the next course). */
  hold?: boolean;
};

/** The price of a dish in a portion: the portion's own, or the product's for the plain one. */
export function portionPrice(product: ProductRecord, portion: string | undefined): Kurus {
  if (portion === undefined) {
    return product.sellPrice;
  }
  const found = product.portions?.find((item) => item.label === portion);
  if (!found) {
    throw new RangeError(`${product.name} has no portion "${portion}"`);
  }
  return found.price;
}

/** How a line reads on a ticket and a receipt: "Adana kebap (Yarım)". */
export function itemLabel(item: Pick<TabItemRecord, 'name' | 'portion'>): string {
  return item.portion ? `${item.name} (${item.portion})` : item.name;
}

/** The choices given must be the dish's own, and every required group answered. */
function checkOptions(product: ProductRecord, options: readonly string[]): void {
  const groups = product.optionGroups ?? [];
  const known = new Set(groups.flatMap((group) => group.choices));
  const unknown = options.find((option) => !known.has(option));
  if (unknown !== undefined) {
    throw new RangeError(`${product.name} has no choice "${unknown}"`);
  }
  const missing = groups.find(
    (group) => group.required && !group.choices.some((choice) => options.includes(choice)),
  );
  if (missing) {
    throw new RangeError(`${product.name} needs a choice for ${missing.name}`);
  }
}

/** A line being taken: it can change or go until the order is sent. */
export async function addTabItem(
  db: MarketDb,
  tabId: string,
  product: ProductRecord,
  input: OrderInput,
  waiter: Waiter,
  at: Date,
): Promise<TabItemRecord> {
  assertSafeInteger(input.qtyMilli, 'qtyMilli');
  if (input.qtyMilli <= 0 || (product.unit === 'piece' && input.qtyMilli % 1000 !== 0)) {
    throw new RangeError(`Cannot order ${input.qtyMilli} of ${product.name}`);
  }
  const price = portionPrice(product, input.portion);
  const options = [...(input.options ?? [])];
  checkOptions(product, options);
  return db.transaction('rw', db.tabs, db.tabItems, db.outbox, async () => {
    const tab = await requireOpenTab(db, tabId);
    if (tab.billRequestedAt) {
      throw new RangeError('The bill was asked for: unlock the tab to add to it');
    }
    const stamp = at.toISOString();
    const record: TabItemRecord = withoutUndefined({
      id: newId(at.getTime()),
      tabId,
      productId: product.id,
      name: product.name,
      unit: product.unit,
      unitPrice: price,
      qtyMilli: input.qtyMilli,
      note: input.note?.trim() || undefined,
      portion: input.portion,
      options: options.length > 0 ? options : undefined,
      hold: input.hold ? true : undefined,
      station: stationOf(product),
      status: 'new' as const,
      deviceCode: waiter.deviceCode,
      staffId: waiter.staffId,
      orderedAt: stamp,
      createdAt: stamp,
      updatedAt: stamp,
    });
    await db.tabItems.add(record);
    await appendOutbox(db, { kind: 'insert', table: 'tabItems', recordId: record.id, record }, at);
    return record;
  });
}

/** Changes how many, or the note, of a line not yet sent. */
export async function changeNewItem(
  db: MarketDb,
  itemId: string,
  input: { qtyMilli?: number; note?: string },
  at: Date,
): Promise<void> {
  await db.transaction('rw', db.tabItems, db.outbox, async () => {
    const item = await requireItem(db, itemId);
    if (item.status !== 'new') {
      throw new RangeError('Only a line not yet sent can change');
    }
    const changes: Record<string, unknown> = {};
    if (input.qtyMilli !== undefined) {
      assertSafeInteger(input.qtyMilli, 'qtyMilli');
      if (input.qtyMilli <= 0 || (item.unit === 'piece' && input.qtyMilli % 1000 !== 0)) {
        throw new RangeError(`Cannot order ${input.qtyMilli}`);
      }
      changes.qtyMilli = input.qtyMilli;
    }
    if (input.note !== undefined) {
      changes.note = input.note.trim() || null;
    }
    await patch(db, 'tabItems', itemId, changes, at);
  });
}

/** Keeps a line still being taken back for the next course, or lets it go with the order. */
export async function setHold(
  db: MarketDb,
  itemId: string,
  hold: boolean,
  at: Date,
): Promise<void> {
  await db.transaction('rw', db.tabItems, db.outbox, async () => {
    const item = await requireItem(db, itemId);
    if (item.status !== 'new') {
      throw new RangeError('Only a line not yet sent can be held');
    }
    await patch(db, 'tabItems', itemId, { hold: hold ? true : null }, at);
  });
}

/** A line not yet sent is simply taken off; nobody started on it. */
export async function removeNewItem(db: MarketDb, itemId: string, at: Date): Promise<void> {
  await db.transaction('rw', db.tabItems, db.outbox, async () => {
    const item = await requireItem(db, itemId);
    if (item.status !== 'new') {
      throw new RangeError('A sent line is voided with a reason');
    }
    await patch(
      db,
      'tabItems',
      itemId,
      { status: 'void', voidReason: 'Gönderilmeden çıkarıldı' },
      at,
    );
  });
}

/** Takes back a line already sent, with why: it leaves the bill and the kitchen's screen. */
export async function voidItem(
  db: MarketDb,
  itemId: string,
  reason: string,
  at: Date,
): Promise<void> {
  const why = reason.trim();
  if (why === '') {
    throw new RangeError('A void needs a reason');
  }
  await db.transaction('rw', db.tabItems, db.outbox, async () => {
    const item = await requireItem(db, itemId);
    if (item.paidSaleId) {
      throw new RangeError('A paid line is returned from its receipt, not voided');
    }
    await patch(db, 'tabItems', itemId, { status: 'void', voidReason: why }, at);
  });
}

/** On the house, or back to being charged. */
export async function setComplimentary(
  db: MarketDb,
  itemId: string,
  complimentary: boolean,
  at: Date,
): Promise<void> {
  await db.transaction('rw', db.tabItems, db.outbox, async () => {
    const item = await requireItem(db, itemId);
    if (item.paidSaleId || item.status === 'void') {
      throw new RangeError('Only an unpaid line can be made complimentary');
    }
    await patch(db, 'tabItems', itemId, { complimentary: complimentary ? true : null }, at);
  });
}

/**
 * Sends the lines still being taken: to the kitchen or the bar, or straight to ready for what
 * needs no preparing. Returns how many went.
 */
export async function sendTab(db: MarketDb, tabId: string, at: Date): Promise<number> {
  return db.transaction('rw', db.tabs, db.tabItems, db.outbox, async () => {
    await requireOpenTab(db, tabId);
    const stamp = at.toISOString();
    const waiting = (await db.tabItems.where('tabId').equals(tabId).toArray()).filter(
      (item) => item.status === 'new',
    );
    for (const item of waiting) {
      await patch(
        db,
        'tabItems',
        item.id,
        item.hold ? { status: 'held' } : started(item, stamp),
        at,
      );
    }
    return waiting.length;
  });
}

/** A line on its way: to its station, or ready at once when nothing has to be prepared. */
function started(item: TabItemRecord, stamp: string): Record<string, unknown> {
  return item.station === 'none'
    ? { status: 'ready', sentAt: stamp, readyAt: stamp }
    : { status: 'sent', sentAt: stamp };
}

/** Fires the course kept back: the held lines go to their stations now. Returns how many. */
export async function fireHeld(db: MarketDb, tabId: string, at: Date): Promise<number> {
  return db.transaction('rw', db.tabs, db.tabItems, db.outbox, async () => {
    await requireOpenTab(db, tabId);
    const held = (await db.tabItems.where('tabId').equals(tabId).toArray()).filter(
      (item) => item.status === 'held',
    );
    for (const item of held) {
      await patch(db, 'tabItems', item.id, started(item, at.toISOString()), at);
    }
    return held.length;
  });
}

/** One more of a line already ordered, the same portion, choices and note: a new line to send. */
export async function repeatItem(
  db: MarketDb,
  itemId: string,
  waiter: Waiter,
  at: Date,
): Promise<TabItemRecord> {
  const item = await requireItem(db, itemId);
  const product = await db.products.get(item.productId);
  if (!product || product.deletedAt) {
    throw new RecordNotFoundError('Product', item.productId);
  }
  return addTabItem(
    db,
    item.tabId,
    product,
    {
      qtyMilli: item.qtyMilli,
      ...(item.note ? { note: item.note } : {}),
      ...(item.portion ? { portion: item.portion } : {}),
      ...(item.options ? { options: item.options } : {}),
    },
    waiter,
    at,
  );
}

/** The bill is asked for: the table shows it and takes no new lines until unlocked or paid. */
export async function requestBill(db: MarketDb, tabId: string, at: Date): Promise<void> {
  await db.transaction('rw', db.tabs, db.outbox, async () => {
    await requireOpenTab(db, tabId);
    await patch(db, 'tabs', tabId, { billRequestedAt: at.toISOString() }, at);
  });
}

/** Back to ordering after a bill was asked for. */
export async function cancelBillRequest(db: MarketDb, tabId: string, at: Date): Promise<void> {
  await db.transaction('rw', db.tabs, db.outbox, async () => {
    await requireOpenTab(db, tabId);
    await patch(db, 'tabs', tabId, { billRequestedAt: null }, at);
  });
}

/** The kitchen or the bar has prepared these lines. */
export async function markReady(db: MarketDb, itemIds: readonly string[], at: Date): Promise<void> {
  await db.transaction('rw', db.tabItems, db.outbox, async () => {
    for (const id of itemIds) {
      const item = await requireItem(db, id);
      if (item.status === 'sent') {
        await patch(db, 'tabItems', id, { status: 'ready', readyAt: at.toISOString() }, at);
      }
    }
  });
}

export type KitchenTicket = {
  tab: TabRecord;
  /** The table's name, or the takeaway order's label. */
  title: string;
  /** What to prepare now. */
  items: TabItemRecord[];
  /** The next course, kept back until the waiter fires it: shown so the station can plan. */
  held: TabItemRecord[];
  /** When the oldest of its lines was sent (or ordered, for a ticket with only held lines). */
  sentAt: string;
};

/** What a station has to prepare, one ticket per tab, the longest waiting first. */
export async function kitchenTickets(db: MarketDb, station: Station): Promise<KitchenTicket[]> {
  const [sent, held] = await Promise.all([
    db.tabItems.where('status').equals('sent').toArray(),
    db.tabItems.where('status').equals('held').toArray(),
  ]);
  const byTab = new Map<string, { items: TabItemRecord[]; held: TabItemRecord[] }>();
  const entry = (tabId: string) => {
    const found = byTab.get(tabId) ?? { items: [], held: [] };
    byTab.set(tabId, found);
    return found;
  };
  for (const item of sent.filter((line) => line.station === station)) {
    entry(item.tabId).items.push(item);
  }
  for (const item of held.filter((line) => line.station === station)) {
    entry(item.tabId).held.push(item);
  }
  const tickets: KitchenTicket[] = [];
  for (const [tabId, lines] of byTab) {
    const tab = await db.tabs.get(tabId);
    if (!tab) {
      continue;
    }
    lines.items.sort((a, b) => (a.sentAt ?? '').localeCompare(b.sentAt ?? ''));
    lines.held.sort((a, b) => a.orderedAt.localeCompare(b.orderedAt));
    tickets.push({
      tab,
      title: await tabTitle(db, tab),
      items: lines.items,
      held: lines.held,
      sentAt: lines.items[0]?.sentAt ?? lines.held[0]?.orderedAt ?? tab.openedAt,
    });
  }
  // Tickets with something to make come first; those only waiting to be fired after them.
  return tickets.sort(
    (a, b) =>
      Number(a.items.length === 0) - Number(b.items.length === 0) ||
      a.sentAt.localeCompare(b.sentAt),
  );
}

/** How many of each dish a station has still to make, across every ticket ("Adana ×9"). */
export async function allDayCounts(
  db: MarketDb,
  station: Station,
): Promise<{ name: string; qtyMilli: number }[]> {
  const sent = (await db.tabItems.where('status').equals('sent').toArray()).filter(
    (item) => item.station === station,
  );
  const counts = new Map<string, number>();
  for (const item of sent) {
    const label = itemLabel(item);
    counts.set(label, (counts.get(label) ?? 0) + item.qtyMilli);
  }
  return [...counts]
    .map(([name, qtyMilli]) => ({ name, qtyMilli }))
    .sort((a, b) => byName.compare(a.name, b.name));
}

/**
 * Brings back what a station last marked ready, by mistake: every line marked in that same
 * moment returns to its ticket. Returns how many came back.
 */
export async function recallLast(db: MarketDb, station: Station, at: Date): Promise<number> {
  return db.transaction('rw', db.tabItems, db.outbox, async () => {
    const ready = (await db.tabItems.where('status').equals('ready').toArray()).filter(
      (item) => item.station === station && item.readyAt && !item.paidSaleId,
    );
    const last = ready.reduce<string | undefined>(
      (latest, item) =>
        latest === undefined || (item.readyAt ?? '') > latest ? item.readyAt : latest,
      undefined,
    );
    if (last === undefined) {
      return 0;
    }
    const back = ready.filter((item) => item.readyAt === last);
    for (const item of back) {
      await patch(db, 'tabItems', item.id, { status: 'sent', readyAt: null }, at);
    }
    return back.length;
  });
}

/** A tab's name as people say it: its table's, or the takeaway order's. */
export async function tabTitle(db: MarketDb, tab: TabRecord): Promise<string> {
  if (tab.tableId) {
    const name = (await db.diningTables.get(tab.tableId))?.name ?? '';
    // "3" alone reads as a count; "Masa 3" is how it is said.
    return /^\d+$/.test(name) ? `Masa ${name}` : name || 'Masa';
  }
  return tab.label ?? 'Paket';
}

// --- The bill -----------------------------------------------------------------------------------

export type BillLine = { item: TabItemRecord; amount: Kurus };
export type TabBill = { lines: BillLine[]; total: Kurus };

const payable = (item: TabItemRecord) => item.status !== 'void' && !item.paidSaleId;

/** What is left to pay on a tab, at the products' prices now; a treat costs nothing. */
export async function tabBill(
  db: MarketDb,
  tabId: string,
  itemIds?: readonly string[],
): Promise<TabBill> {
  const items = (await db.tabItems.where('tabId').equals(tabId).toArray())
    .filter(payable)
    .filter((item) => itemIds === undefined || itemIds.includes(item.id))
    .sort((a, b) => a.orderedAt.localeCompare(b.orderedAt) || a.id.localeCompare(b.id));
  const products = await db.products.bulkGet(items.map((item) => item.productId));
  const priced = items.map((item, index) => {
    const price = currentPrice(item, products[index]);
    const gross = lineTotal(item.qtyMilli, price);
    return { item, price, gross, discount: item.complimentary ? gross : 0 };
  });
  const cart = computeCart(
    priced.map(({ item, price, discount }, index) => ({
      qtyMilli: item.qtyMilli,
      unitPrice: price,
      vatRate: products[index]?.vatRate ?? 1,
      lineDiscount: discount,
    })),
    0,
  );
  return {
    lines: priced.map(({ item, gross, discount }) => ({ item, amount: gross - discount })),
    total: cart.total,
  };
}

/**
 * Pays some lines of a tab (or all that are left) as one sale: the receipt, the stock and the
 * reports are the register's own. The tab closes once nothing is left to pay; a tab with nothing
 * ever on it closes as cancelled.
 */
export async function payTabItems(
  db: MarketDb,
  input: Waiter & {
    tabId: string;
    itemIds: readonly string[];
    payments: Payment[];
    cashGiven?: Kurus;
    cutoffMinutes?: number;
  },
  at: Date,
): Promise<SaleRecord | { total: 0; cancelled: true }> {
  const tables = [
    db.tabs,
    db.tabItems,
    db.sales,
    db.products,
    db.customers,
    db.stockMovements,
    db.stockLevels,
    db.ledger,
    db.outbox,
  ];
  return db.transaction('rw', tables, async () => {
    await requireOpenTab(db, input.tabId);
    const all = await db.tabItems.where('tabId').equals(input.tabId).toArray();
    const open = all.filter(payable);
    if (input.itemIds.length === 0) {
      if (open.length > 0) {
        throw new RangeError('Choose the lines to pay');
      }
      const paidBefore = all.some((item) => item.paidSaleId);
      await patch(
        db,
        'tabs',
        input.tabId,
        { status: paidBefore ? 'paid' : 'cancelled', closedAt: at.toISOString() },
        at,
      );
      return { total: 0, cancelled: true } as const;
    }
    const chosen = input.itemIds.map((id) => open.find((item) => item.id === id));
    if (chosen.some((item) => item === undefined)) {
      throw new RangeError('A chosen line is paid, voided or not on this tab');
    }
    const products = await db.products.bulkGet(chosen.map((item) => item!.productId));
    const sale = await recordSale(db, {
      deviceCode: input.deviceCode,
      at,
      cutoffMinutes: input.cutoffMinutes,
      staffId: input.staffId,
      lines: chosen.map((item, index) => {
        const price = currentPrice(item!, products[index]);
        return {
          productId: item!.productId,
          qtyMilli: item!.qtyMilli,
          lineDiscount: item!.complimentary ? lineTotal(item!.qtyMilli, price) : 0,
          ...(item!.portion ? { unitPrice: price, label: itemLabel(item!) } : {}),
        };
      }),
      payments: input.payments,
      ...(input.cashGiven !== undefined ? { cashGiven: input.cashGiven } : {}),
    });
    for (const item of chosen) {
      await patch(db, 'tabItems', item!.id, { paidSaleId: sale.id }, at);
    }
    if (open.length === chosen.length) {
      await patch(db, 'tabs', input.tabId, { status: 'paid', closedAt: at.toISOString() }, at);
    }
    return sale;
  });
}

// --- Helpers ------------------------------------------------------------------------------------

/**
 * A line's price now: its portion's, or the product's, as the menu stands; the price it was
 * ordered at when the product or the portion is gone.
 */
function currentPrice(item: TabItemRecord, product: ProductRecord | undefined): Kurus {
  if (!product) {
    return item.unitPrice;
  }
  if (!item.portion) {
    return product.sellPrice;
  }
  return (
    product.portions?.find((portion) => portion.label === item.portion)?.price ?? item.unitPrice
  );
}

async function requireOpenTab(db: MarketDb, tabId: string): Promise<TabRecord> {
  const tab = await db.tabs.get(tabId);
  if (!tab) {
    throw new RecordNotFoundError('Tab', tabId);
  }
  if (tab.status !== 'open') {
    throw new RangeError('This tab is closed');
  }
  return tab;
}

async function requireItem(db: MarketDb, itemId: string): Promise<TabItemRecord> {
  const item = await db.tabItems.get(itemId);
  if (!item) {
    throw new RecordNotFoundError('TabItem', itemId);
  }
  return item;
}

/** Changes the given fields of a record and queues the change; null clears a field. */
async function patch(
  db: MarketDb,
  table: 'diningTables' | 'tabs' | 'tabItems',
  id: string,
  changes: Record<string, unknown>,
  at: Date,
): Promise<void> {
  const target = db.table(table);
  const current = (await target.get(id)) as Record<string, unknown> | undefined;
  if (!current) {
    throw new RecordNotFoundError(table, id);
  }
  const stamp = at.toISOString();
  const next: Record<string, unknown> = { ...current, updatedAt: stamp };
  for (const [key, value] of Object.entries(changes)) {
    if (value === null || value === undefined) {
      delete next[key];
    } else {
      next[key] = value;
    }
  }
  await target.put(next);
  const sent = Object.fromEntries(
    Object.entries(changes).map(([key, value]) => [key, value === undefined ? null : value]),
  );
  await appendOutbox(
    db,
    { kind: 'patch', table, recordId: id, patch: { ...sent, updatedAt: stamp } },
    at,
  );
}
