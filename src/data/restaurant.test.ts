import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestDb } from '@/test/db';
import type { MarketDb } from './db';
import { pendingOps } from './outbox';
import { createProduct, updateProduct } from './products';
import {
  addTabItem,
  archiveDiningTable,
  createDiningTable,
  kitchenTickets,
  listDiningTables,
  markReady,
  mergeTabs,
  moveTab,
  openTab,
  openTabs,
  payTabItems,
  removeNewItem,
  sendTab,
  setComplimentary,
  tabBill,
  tabTitle,
  voidItem,
} from './restaurant';
import { recentSales } from './sales';

let db: MarketDb;
beforeEach(() => {
  db = makeTestDb();
});
afterEach(async () => {
  await db.delete();
});

const at = new Date('2026-11-14T18:00:00Z');
const later = (minutes: number) => new Date(at.getTime() + minutes * 60_000);
const waiter = { deviceCode: 'K1', staffId: 'ayse' };

async function menu() {
  const kebab = await createProduct(
    db,
    { name: 'Adana kebap', sellPrice: 45000, vatRate: 10, station: 'kitchen' },
    at,
  );
  const raki = await createProduct(
    db,
    { name: 'Rakı 35 cl', sellPrice: 60000, vatRate: 20, station: 'bar' },
    at,
  );
  const water = await createProduct(
    db,
    { name: 'Su', sellPrice: 2000, vatRate: 1, station: 'none' },
    at,
  );
  return { kebab, raki, water };
}

describe('dining tables', () => {
  it('lists the live tables by area and order', async () => {
    const garden = await createDiningTable(db, { name: 'B1', area: 'Bahçe' }, at);
    await createDiningTable(db, { name: 'S2', area: 'Salon' }, at);
    await createDiningTable(db, { name: 'S1', area: 'Salon' }, at);
    await archiveDiningTable(db, garden.id, at);
    expect((await listDiningTables(db)).map((table) => table.name)).toEqual(['S2', 'S1']);
    await expect(createDiningTable(db, { name: ' ', area: 'Salon' }, at)).rejects.toThrow(
      RangeError,
    );
  });
});

describe('names on the floor', () => {
  it('keeps the areas in the order they were added, and calls a numbered table “Masa”', async () => {
    await createDiningTable(db, { name: '1', area: 'Salon' }, at);
    await createDiningTable(db, { name: 'B1', area: 'Bahçe' }, at);
    await createDiningTable(db, { name: '2', area: 'Salon' }, at);
    expect((await listDiningTables(db)).map((table) => table.name)).toEqual(['1', '2', 'B1']);
    const [one, , garden] = await listDiningTables(db);
    expect(await tabTitle(db, await openTab(db, { tableId: one!.id, ...waiter }, at))).toBe(
      'Masa 1',
    );
    expect(await tabTitle(db, await openTab(db, { tableId: garden!.id, ...waiter }, at))).toBe(
      'B1',
    );
  });
});

describe('a table’s tab', () => {
  it('opens one tab per table and finds it again', async () => {
    const table = await createDiningTable(db, { name: 'S1', area: 'Salon' }, at);
    const tab = await openTab(db, { tableId: table.id, ...waiter }, at);
    expect(tab).toMatchObject({ tableId: table.id, status: 'open', staffId: 'ayse' });
    expect((await openTab(db, { tableId: table.id, ...waiter }, later(1))).id).toBe(tab.id);
    expect((await openTabs(db)).map((open) => open.id)).toEqual([tab.id]);
  });

  it('takes an order, sends it to the kitchen and the bar, and marks it ready', async () => {
    const { kebab, raki, water } = await menu();
    const tab = await openTab(db, { label: 'Paket 1', ...waiter }, at);
    const plate = await addTabItem(
      db,
      tab.id,
      kebab,
      { qtyMilli: 2000, note: 'acısız' },
      waiter,
      at,
    );
    await addTabItem(db, tab.id, raki, { qtyMilli: 1000 }, waiter, at);
    await addTabItem(db, tab.id, water, { qtyMilli: 2000 }, waiter, at);
    expect(plate).toMatchObject({ status: 'new', station: 'kitchen', note: 'acısız' });

    expect(await sendTab(db, tab.id, later(1))).toBe(3);
    const kitchen = await kitchenTickets(db, 'kitchen');
    expect(kitchen).toHaveLength(1);
    expect(kitchen[0]?.items.map((item) => item.name)).toEqual(['Adana kebap']);
    expect((await kitchenTickets(db, 'bar'))[0]?.items.map((item) => item.name)).toEqual([
      'Rakı 35 cl',
    ]);
    // Water needs no preparing: it is ready as soon as it is sent.
    expect((await db.tabItems.toArray()).find((item) => item.name === 'Su')?.status).toBe('ready');

    await markReady(db, [plate.id], later(10));
    expect(await kitchenTickets(db, 'kitchen')).toEqual([]);
    // Nothing new is left to send.
    expect(await sendTab(db, tab.id, later(11))).toBe(0);
  });

  it('drops a line not yet sent, and voids a sent one only with a reason', async () => {
    const { kebab } = await menu();
    const tab = await openTab(db, { label: 'Paket 1', ...waiter }, at);
    const first = await addTabItem(db, tab.id, kebab, { qtyMilli: 1000 }, waiter, at);
    await removeNewItem(db, first.id, at);
    expect((await db.tabItems.get(first.id))?.status).toBe('void');

    const second = await addTabItem(db, tab.id, kebab, { qtyMilli: 1000 }, waiter, at);
    await sendTab(db, tab.id, at);
    await expect(removeNewItem(db, second.id, at)).rejects.toThrow(RangeError);
    await expect(voidItem(db, second.id, ' ', at)).rejects.toThrow(RangeError);
    await voidItem(db, second.id, 'Müşteri vazgeçti', at);
    expect(await db.tabItems.get(second.id)).toMatchObject({
      status: 'void',
      voidReason: 'Müşteri vazgeçti',
    });
  });

  it('bills at the products’ prices now, with the house’s treats at no charge', async () => {
    const { kebab, raki } = await menu();
    const tab = await openTab(db, { label: 'Paket 1', ...waiter }, at);
    await addTabItem(db, tab.id, kebab, { qtyMilli: 2000 }, waiter, at);
    const glass = await addTabItem(db, tab.id, raki, { qtyMilli: 1000 }, waiter, later(1));
    await setComplimentary(db, glass.id, true, at);
    await updateProduct(db, kebab.id, { sellPrice: 50000 }, at);
    const bill = await tabBill(db, tab.id);
    expect(bill.total).toBe(100000);
    expect(bill.lines.map((line) => [line.item.name, line.amount])).toEqual([
      ['Adana kebap', 100000],
      ['Rakı 35 cl', 0],
    ]);
  });

  it('is paid in parts, and closes when nothing is left to pay', async () => {
    const { kebab, raki } = await menu();
    const tab = await openTab(db, { label: 'Paket 1', ...waiter }, at);
    const plate = await addTabItem(db, tab.id, kebab, { qtyMilli: 1000 }, waiter, at);
    const glass = await addTabItem(db, tab.id, raki, { qtyMilli: 1000 }, waiter, at);
    await sendTab(db, tab.id, at);

    const first = await payTabItems(
      db,
      {
        tabId: tab.id,
        itemIds: [plate.id],
        payments: [{ method: 'card', amount: 45000 }],
        ...waiter,
      },
      later(30),
    );
    expect(first.total).toBe(45000);
    expect((await db.tabs.get(tab.id))?.status).toBe('open');
    expect((await tabBill(db, tab.id)).total).toBe(60000);

    await payTabItems(
      db,
      {
        tabId: tab.id,
        itemIds: [glass.id],
        payments: [{ method: 'cash', amount: 60000 }],
        cashGiven: 100000,
        ...waiter,
      },
      later(31),
    );
    expect(await db.tabs.get(tab.id)).toMatchObject({ status: 'paid' });
    expect(await recentSales(db)).toHaveLength(2);
    expect((await db.tabItems.get(glass.id))?.paidSaleId).toBeDefined();
    await expect(
      payTabItems(
        db,
        {
          tabId: tab.id,
          itemIds: [glass.id],
          payments: [{ method: 'cash', amount: 60000 }],
          ...waiter,
        },
        later(32),
      ),
    ).rejects.toThrow(RangeError);
  });

  it('moves to an empty table, and merges into another table’s tab', async () => {
    const { kebab, raki } = await menu();
    const [s1, s2, s3] = await Promise.all(
      ['S1', 'S2', 'S3'].map((name) => createDiningTable(db, { name, area: 'Salon' }, at)),
    );
    const tab = await openTab(db, { tableId: s1!.id, ...waiter }, at);
    await addTabItem(db, tab.id, kebab, { qtyMilli: 1000 }, waiter, at);
    await moveTab(db, tab.id, s2!.id, at);
    expect((await db.tabs.get(tab.id))?.tableId).toBe(s2!.id);

    const other = await openTab(db, { tableId: s3!.id, ...waiter }, at);
    await addTabItem(db, other.id, raki, { qtyMilli: 1000 }, waiter, at);
    await expect(moveTab(db, tab.id, s3!.id, at)).rejects.toThrow(RangeError);
    await mergeTabs(db, tab.id, other.id, at);
    expect((await db.tabs.get(tab.id))?.status).toBe('merged');
    expect((await tabBill(db, other.id)).total).toBe(105000);
  });

  it('closes a tab with nothing on it', async () => {
    const tab = await openTab(db, { label: 'Paket 1', ...waiter }, at);
    await payTabItems(db, { tabId: tab.id, itemIds: [], payments: [], ...waiter }, at);
    expect((await db.tabs.get(tab.id))?.status).toBe('cancelled');
  });

  it('syncs every change it makes', async () => {
    const { kebab } = await menu();
    const table = await createDiningTable(db, { name: 'S1', area: 'Salon' }, at);
    const tab = await openTab(db, { tableId: table.id, ...waiter }, at);
    const plate = await addTabItem(db, tab.id, kebab, { qtyMilli: 1000 }, waiter, at);
    await sendTab(db, tab.id, at);
    await markReady(db, [plate.id], at);
    const tables = (await pendingOps(db, 500)).map((op) => `${op.table}:${op.kind}`);
    expect(tables).toEqual(
      expect.arrayContaining([
        'diningTables:insert',
        'tabs:insert',
        'tabItems:insert',
        'tabItems:patch',
      ]),
    );
  });
});
