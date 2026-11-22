import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { takeReadyNews } from '@/notify/readyNotices';
import { openMarketDb, type MarketDb } from './db';
import { deliverTab } from './deliver';
import { pendingOps } from './outbox';
import { createProduct } from './products';
import {
  addTabItem,
  allDayCounts,
  createDiningTable,
  kitchenTickets,
  openTab,
  payTabItems,
  readyToServe,
  recallLast,
  sendTab,
  setHold,
  tabBill,
} from './restaurant';

let db: MarketDb;
beforeEach(() => {
  db = openMarketDb(`test-${crypto.randomUUID()}`);
});
afterEach(async () => {
  await db.delete();
});

const at = new Date('2026-11-22T18:00:00Z');
const later = (minutes: number) => new Date(at.getTime() + minutes * 60_000);
const ali = { deviceCode: 'P1', staffId: 'ali' };

async function barTable() {
  const beer = await createProduct(
    db,
    { name: 'Efes', sellPrice: 15000, vatRate: 20, station: 'bar' },
    at,
  );
  const kebab = await createProduct(
    db,
    { name: 'Adana kebap', sellPrice: 45000, vatRate: 10, station: 'kitchen' },
    at,
  );
  const table = await createDiningTable(db, { name: '5', area: 'Salon' }, at);
  const tab = await openTab(db, { tableId: table.id, ...ali }, at);
  return { beer, kebab, tab };
}

describe('deliverTab', () => {
  it('hands the lines being taken over at once: ready and served, sent and delivered at the same moment', async () => {
    const { beer, tab } = await barTable();
    const line = await addTabItem(db, tab.id, beer, { qtyMilli: 5000 }, ali, at);

    expect(await deliverTab(db, tab.id, later(1))).toBe(1);

    const stamp = later(1).toISOString();
    expect(await db.tabItems.get(line.id)).toMatchObject({
      status: 'ready',
      sentAt: stamp,
      readyAt: stamp,
      servedAt: stamp,
      deliveredAt: stamp,
    });
    const patches = (await pendingOps(db)).flatMap((op) =>
      op.kind === 'patch' && op.recordId === line.id ? [op.patch] : [],
    );
    expect(patches.at(-1)).toEqual({
      status: 'ready',
      sentAt: stamp,
      readyAt: stamp,
      servedAt: stamp,
      deliveredAt: stamp,
      updatedAt: stamp,
    });
  });

  it('gives the kitchen and the bar nothing to make, the floor nothing to carry and nothing to recall', async () => {
    const { beer, kebab, tab } = await barTable();
    await addTabItem(db, tab.id, beer, { qtyMilli: 5000 }, ali, at);
    await addTabItem(db, tab.id, kebab, { qtyMilli: 1000 }, ali, at);
    // The ready-notice log starts before the delivery, so a delivered line would be news.
    const me = { deviceCode: 'P2', staffId: 'ali' };
    await takeReadyNews(db, me, { scope: 'all', quiet: false, now: at });

    await deliverTab(db, tab.id, later(1));

    expect(await kitchenTickets(db, 'bar')).toEqual([]);
    expect(await kitchenTickets(db, 'kitchen')).toEqual([]);
    expect(await allDayCounts(db, 'bar')).toEqual([]);
    expect(await readyToServe(db, tab.id)).toEqual([]);
    expect(await recallLast(db, 'bar', later(2))).toBe(0);
    expect(await recallLast(db, 'kitchen', later(2))).toBe(0);
    expect(await takeReadyNews(db, me, { scope: 'all', quiet: false, now: later(2) })).toEqual([]);
    // Still on the bill, to be paid like any line.
    expect((await tabBill(db, tab.id)).total).toBe(5 * 15000 + 45000);
  });

  it('leaves the next course kept back, and what was sent already', async () => {
    const { beer, kebab, tab } = await barTable();
    const sent = await addTabItem(db, tab.id, kebab, { qtyMilli: 1000 }, ali, at);
    await sendTab(db, tab.id, later(1));
    const course = await addTabItem(db, tab.id, kebab, { qtyMilli: 1000 }, ali, later(2));
    await setHold(db, course.id, true, later(2));
    const drink = await addTabItem(db, tab.id, beer, { qtyMilli: 2000 }, ali, later(2));

    expect(await deliverTab(db, tab.id, later(3))).toBe(1);

    expect((await db.tabItems.get(drink.id))?.status).toBe('ready');
    expect(await db.tabItems.get(course.id)).toMatchObject({ status: 'new', hold: true });
    expect(await db.tabItems.get(sent.id)).toMatchObject({
      status: 'sent',
      sentAt: later(1).toISOString(),
    });
    expect((await db.tabItems.get(sent.id))?.deliveredAt).toBeUndefined();
  });

  it('refuses a tab that is closed', async () => {
    const { tab } = await barTable();
    // Left with nothing ordered: it closes as cancelled.
    await payTabItems(db, { tabId: tab.id, itemIds: [], payments: [], ...ali }, later(1));
    await expect(deliverTab(db, tab.id, later(2))).rejects.toThrow(RangeError);
  });
});
