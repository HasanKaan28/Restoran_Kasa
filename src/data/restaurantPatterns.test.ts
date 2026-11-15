import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestDb } from '@/test/db';
import type { MarketDb } from './db';
import { createProduct } from './products';
import {
  addTabItem,
  allDayCounts,
  cancelBillRequest,
  fireHeld,
  kitchenTickets,
  markReady,
  openTab,
  payTabItems,
  recallLast,
  repeatItem,
  requestBill,
  sendTab,
  tabBill,
} from './restaurant';
import { recordSale } from './sales';

let db: MarketDb;
beforeEach(() => {
  db = makeTestDb();
});
afterEach(async () => {
  await db.delete();
});

const at = new Date('2026-11-15T18:00:00Z');
const later = (minutes: number) => new Date(at.getTime() + minutes * 60_000);
const waiter = { deviceCode: 'K1' };

async function menu() {
  const adana = await createProduct(
    db,
    {
      name: 'Adana kebap',
      sellPrice: 45000,
      vatRate: 10,
      portions: [
        { label: 'Yarım', price: 25000 },
        { label: '1,5', price: 65000 },
      ],
      optionGroups: [{ name: 'Acı', choices: ['Acılı', 'Acısız'], required: true }],
    },
    at,
  );
  const meze = await createProduct(db, { name: 'Ezme', sellPrice: 11000, vatRate: 10 }, at);
  const raki = await createProduct(
    db,
    { name: 'Rakı', sellPrice: 85000, vatRate: 20, station: 'bar' },
    at,
  );
  return { adana, meze, raki };
}

describe('a sale line at its own price', () => {
  it('sells at the price and under the name the line gives', async () => {
    const { adana } = await menu();
    const sale = await recordSale(db, {
      deviceCode: 'K1',
      at,
      lines: [
        { productId: adana.id, qtyMilli: 1000, unitPrice: 25000, label: 'Adana kebap (Yarım)' },
      ],
      payments: [{ method: 'cash', amount: 25000 }],
    });
    expect(sale.lines[0]).toMatchObject({ name: 'Adana kebap (Yarım)', unitPrice: 25000 });
    expect(sale.total).toBe(25000);
  });
});

describe('portions and options', () => {
  it('orders a portion at its price, with the choices the dish asks for', async () => {
    const { adana } = await menu();
    const tab = await openTab(db, { label: 'Paket', ...waiter }, at);
    const item = await addTabItem(
      db,
      tab.id,
      adana,
      { qtyMilli: 1000, portion: 'Yarım', options: ['Acısız'] },
      waiter,
      at,
    );
    expect(item).toMatchObject({ portion: 'Yarım', options: ['Acısız'], unitPrice: 25000 });
    expect((await tabBill(db, tab.id)).total).toBe(25000);
    const sale = await payTabItems(
      db,
      {
        tabId: tab.id,
        itemIds: [item.id],
        payments: [{ method: 'card', amount: 25000 }],
        ...waiter,
      },
      later(30),
    );
    expect('lines' in sale && sale.lines[0]?.name).toBe('Adana kebap (Yarım)');
  });

  it('refuses a dish whose required choice is missing, or a portion it does not have', async () => {
    const { adana } = await menu();
    const tab = await openTab(db, { label: 'Paket', ...waiter }, at);
    await expect(addTabItem(db, tab.id, adana, { qtyMilli: 1000 }, waiter, at)).rejects.toThrow(
      RangeError,
    );
    await expect(
      addTabItem(
        db,
        tab.id,
        adana,
        { qtyMilli: 1000, portion: 'Duble', options: ['Acılı'] },
        waiter,
        at,
      ),
    ).rejects.toThrow(RangeError);
    // The plain portion needs no name.
    const plain = await addTabItem(
      db,
      tab.id,
      adana,
      { qtyMilli: 1000, options: ['Acılı'] },
      waiter,
      at,
    );
    expect(plain.unitPrice).toBe(45000);
  });
});

describe('the bill requested', () => {
  it('locks the tab against new orders until it is unlocked', async () => {
    const { meze } = await menu();
    const tab = await openTab(db, { label: 'Paket', ...waiter }, at);
    await requestBill(db, tab.id, at);
    expect((await db.tabs.get(tab.id))?.billRequestedAt).toBe(at.toISOString());
    await expect(addTabItem(db, tab.id, meze, { qtyMilli: 1000 }, waiter, at)).rejects.toThrow(
      RangeError,
    );
    await cancelBillRequest(db, tab.id, at);
    await expect(
      addTabItem(db, tab.id, meze, { qtyMilli: 1000 }, waiter, at),
    ).resolves.toBeDefined();
  });
});

describe('holding a course', () => {
  it('sends what is not held, keeps the rest in the queue, then fires it', async () => {
    const { adana, meze } = await menu();
    const tab = await openTab(db, { label: 'Paket', ...waiter }, at);
    await addTabItem(db, tab.id, meze, { qtyMilli: 1000 }, waiter, at);
    const kebab = await addTabItem(
      db,
      tab.id,
      adana,
      { qtyMilli: 2000, options: ['Acılı'], hold: true },
      waiter,
      at,
    );
    await sendTab(db, tab.id, later(1));
    const [ticket] = await kitchenTickets(db, 'kitchen');
    expect(ticket?.items.map((item) => item.name)).toEqual(['Ezme']);
    expect(ticket?.held.map((item) => item.name)).toEqual(['Adana kebap']);
    expect((await db.tabItems.get(kebab.id))?.status).toBe('held');

    expect(await fireHeld(db, tab.id, later(20))).toBe(1);
    expect(await db.tabItems.get(kebab.id)).toMatchObject({
      status: 'sent',
      sentAt: later(20).toISOString(),
    });
  });
});

describe('repeating a line', () => {
  it('adds the same dish again, portion, choices and note included', async () => {
    const { adana } = await menu();
    const tab = await openTab(db, { label: 'Paket', ...waiter }, at);
    const first = await addTabItem(
      db,
      tab.id,
      adana,
      { qtyMilli: 1000, portion: '1,5', options: ['Acılı'], note: 'iyi pişmiş' },
      waiter,
      at,
    );
    await sendTab(db, tab.id, at);
    const again = await repeatItem(db, first.id, waiter, later(10));
    expect(again).toMatchObject({
      status: 'new',
      portion: '1,5',
      options: ['Acılı'],
      note: 'iyi pişmiş',
      qtyMilli: 1000,
    });
  });
});

describe('the kitchen’s counts and recall', () => {
  it('counts every dish still to make, and brings back the last one marked ready', async () => {
    const { adana, meze, raki } = await menu();
    const one = await openTab(db, { label: 'Paket 1', ...waiter }, at);
    const two = await openTab(db, { label: 'Paket 2', ...waiter }, at);
    await addTabItem(db, one.id, adana, { qtyMilli: 2000, options: ['Acılı'] }, waiter, at);
    await addTabItem(
      db,
      two.id,
      adana,
      { qtyMilli: 1000, portion: 'Yarım', options: ['Acılı'] },
      waiter,
      at,
    );
    const ezme = await addTabItem(db, two.id, meze, { qtyMilli: 1000 }, waiter, at);
    await addTabItem(db, two.id, raki, { qtyMilli: 1000 }, waiter, at);
    await sendTab(db, one.id, at);
    await sendTab(db, two.id, at);

    expect(await allDayCounts(db, 'kitchen')).toEqual([
      { name: 'Adana kebap', qtyMilli: 2000 },
      { name: 'Adana kebap (Yarım)', qtyMilli: 1000 },
      { name: 'Ezme', qtyMilli: 1000 },
    ]);

    await markReady(db, [ezme.id], later(5));
    expect(await recallLast(db, 'kitchen', later(6))).toBe(1);
    expect((await db.tabItems.get(ezme.id))?.status).toBe('sent');
    expect(await recallLast(db, 'bar', later(6))).toBe(0);
  });
});
