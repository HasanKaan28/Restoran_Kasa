import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openMarketDb, type MarketDb } from '@/data/db';
import { deliverTab } from '@/data/deliver';
import { createProduct } from '@/data/products';
import {
  addTabItem,
  createDiningTable,
  mergeTabs,
  openTab,
  remakeItem,
  sendTab,
  voidItem,
} from '@/data/restaurant';
import type { StaffRecord } from '@/data/types';
import { lastSlip, slipDateTime, takeNewSlips, type SlipMode } from './orderSlip';

let db: MarketDb;
beforeEach(() => {
  db = openMarketDb(`test-${crypto.randomUUID()}`);
});
afterEach(async () => {
  await db.delete();
});

const at = new Date('2026-11-22T18:00:00Z');
const later = (minutes: number) => new Date(at.getTime() + minutes * 60_000);
const aliOnPhone = { deviceCode: 'P1', staffId: 'ali' };

/** The bar PC turned printing on at `at`. */
const take = (minutes: number, mode: SlipMode = 'all', since = at, most?: number) =>
  takeNewSlips(db, {
    mode,
    since: since.toISOString(),
    now: later(minutes),
    deviceNames: { K1: 'Kasa 1' },
    ...(most === undefined ? {} : { most }),
  });

async function setUp() {
  await db.staff.put({
    id: 'ali',
    name: 'Ali',
    role: 'cashier',
    pinHash: '',
    pinSalt: '',
    pinIterations: 1,
    createdAt: at.toISOString(),
    updatedAt: at.toISOString(),
  } satisfies StaffRecord);
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
  const tab = await openTab(db, { tableId: table.id, ...aliOnPhone }, at);
  return { beer, kebab, tab };
}

describe('takeNewSlips', () => {
  it('marks a remade line "Tekrar" with its short reason, apart from the same dish ordered', async () => {
    const { kebab, tab } = await setUp();
    const first = await addTabItem(db, tab.id, kebab, { qtyMilli: 1000 }, aliOnPhone, later(1));
    await sendTab(db, tab.id, later(2));
    await remakeItem(db, { itemId: first.id, reason: 'Soğuk geldi', ...aliOnPhone }, later(5));

    const slips = await take(10);

    expect(slips.map((slip) => slip.lines)).toEqual([
      [{ label: 'Adana kebap', qtyMilli: 1000, unit: 'piece', details: [] }],
      [
        {
          label: 'Adana kebap',
          qtyMilli: 1000,
          unit: 'piece',
          details: ['Tekrar · Soğuk geldi'],
        },
      ],
    ]);
  });

  it('leaves a long remake reason off the slip', async () => {
    const { kebab, tab } = await setUp();
    const first = await addTabItem(db, tab.id, kebab, { qtyMilli: 1000 }, aliOnPhone, later(1));
    await sendTab(db, tab.id, later(2));
    await remakeItem(
      db,
      { itemId: first.id, reason: 'Müşteri bu yemeği çok soğuk ve tuzlu buldu', ...aliOnPhone },
      later(5),
    );

    const slips = await take(10);

    expect(slips[1]?.lines[0]?.details).toEqual(['Tekrar']);
  });

  it('prints a new order once: what and how many, who entered it, the table and when', async () => {
    const { beer, kebab, tab } = await setUp();
    // Two taps on the same beer can make two lines: the slip says "5 × Efes" all the same.
    await addTabItem(db, tab.id, beer, { qtyMilli: 3000 }, aliOnPhone, later(1));
    await addTabItem(db, tab.id, beer, { qtyMilli: 2000 }, aliOnPhone, later(1));
    await addTabItem(db, tab.id, kebab, { qtyMilli: 1000, note: 'Acısız' }, aliOnPhone, later(1.5));
    await deliverTab(db, tab.id, later(2));

    const slips = await take(3);
    expect(slips).toEqual([
      {
        id: `${tab.id}@${later(2).toISOString()}`,
        tabId: tab.id,
        title: 'Masa 5',
        waiters: ['Ali'],
        devices: [],
        sentAt: later(2).toISOString(),
        delivered: true,
        lines: [
          { label: 'Efes', qtyMilli: 5000, unit: 'piece', details: [] },
          { label: 'Adana kebap', qtyMilli: 1000, unit: 'piece', details: ['Not: Acısız'] },
        ],
      },
    ]);
    // Never again: not on the next look, nor after a reload (the record is in the database).
    expect(await take(4)).toEqual([]);
    expect(await take(60)).toEqual([]);
  });

  it('prints nothing sent before printing was turned on', async () => {
    const { beer, tab } = await setUp();
    await addTabItem(db, tab.id, beer, { qtyMilli: 1000 }, aliOnPhone, later(1));
    await sendTab(db, tab.id, later(2));

    expect(await take(5, 'all', later(3))).toEqual([]);

    await addTabItem(db, tab.id, beer, { qtyMilli: 1000 }, aliOnPhone, later(6));
    await sendTab(db, tab.id, later(7));
    expect((await take(8, 'all', later(3))).map((slip) => slip.sentAt)).toEqual([
      later(7).toISOString(),
    ]);
  });

  it('with "delivered only" prints the orders handed over, not those sent to the kitchen', async () => {
    const { beer, kebab, tab } = await setUp();
    await addTabItem(db, tab.id, kebab, { qtyMilli: 1000 }, aliOnPhone, later(1));
    await sendTab(db, tab.id, later(2));
    await addTabItem(db, tab.id, beer, { qtyMilli: 5000 }, aliOnPhone, later(3));
    await deliverTab(db, tab.id, later(4));

    const slips = await take(5, 'delivered');
    expect(slips.map((slip) => [slip.sentAt, slip.delivered, slip.lines[0]?.label])).toEqual([
      [later(4).toISOString(), true, 'Efes'],
    ]);
    expect(await take(6, 'delivered')).toEqual([]);
  });

  it('with "every order" prints the kitchen’s orders too, the next course when it is fired', async () => {
    const { kebab, tab } = await setUp();
    await addTabItem(db, tab.id, kebab, { qtyMilli: 2000 }, aliOnPhone, later(1));
    await sendTab(db, tab.id, later(2));
    expect((await take(3)).map((slip) => [slip.delivered, slip.lines])).toEqual([
      [false, [{ label: 'Adana kebap', qtyMilli: 2000, unit: 'piece', details: [] }]],
    ]);
  });

  it('prints a line that comes late by sync on its own, and never prints a line twice', async () => {
    const { beer, kebab, tab } = await setUp();
    const first = await addTabItem(db, tab.id, beer, { qtyMilli: 1000 }, aliOnPhone, later(1));
    await addTabItem(db, tab.id, kebab, { qtyMilli: 1000 }, aliOnPhone, later(1));
    await sendTab(db, tab.id, later(2));
    // Only the beer has arrived here yet.
    const kebabLine = (await db.tabItems.where('tabId').equals(tab.id).toArray()).find(
      (item) => item.id !== first.id,
    )!;
    await db.tabItems.delete(kebabLine.id);
    expect((await take(3)).flatMap((slip) => slip.lines.map((line) => line.label))).toEqual([
      'Efes',
    ]);

    await db.tabItems.put(kebabLine);
    expect((await take(4)).flatMap((slip) => slip.lines.map((line) => line.label))).toEqual([
      'Adana kebap',
    ]);
  });

  it('does not print again what moves to another table’s tab', async () => {
    const { beer, tab } = await setUp();
    await addTabItem(db, tab.id, beer, { qtyMilli: 1000 }, aliOnPhone, later(1));
    await sendTab(db, tab.id, later(2));
    expect(await take(3)).toHaveLength(1);

    const six = await createDiningTable(db, { name: '6', area: 'Salon' }, at);
    const other = await openTab(db, { tableId: six.id, ...aliOnPhone }, later(4));
    await mergeTabs(db, tab.id, other.id, later(5));
    expect(await take(6)).toEqual([]);
  });

  it('waits for the tab of an order to arrive before printing it', async () => {
    const { beer, tab } = await setUp();
    await addTabItem(db, tab.id, beer, { qtyMilli: 1000 }, aliOnPhone, later(1));
    await sendTab(db, tab.id, later(2));
    const record = (await db.tabs.get(tab.id))!;
    await db.tabs.delete(tab.id);
    expect(await take(3)).toEqual([]);

    await db.tabs.put(record);
    expect(await take(4)).toHaveLength(1);
  });

  it('leaves voided lines off, and an order taken back whole prints nothing', async () => {
    const { beer, kebab, tab } = await setUp();
    const drink = await addTabItem(db, tab.id, beer, { qtyMilli: 1000 }, aliOnPhone, later(1));
    await addTabItem(db, tab.id, kebab, { qtyMilli: 1000 }, aliOnPhone, later(1));
    await sendTab(db, tab.id, later(2));
    await voidItem(db, drink.id, 'Yanlış masa', later(2));
    expect((await take(3)).flatMap((slip) => slip.lines.map((line) => line.label))).toEqual([
      'Adana kebap',
    ]);
  });

  it('says the device that entered a line with no staff, by name when known, by code otherwise', async () => {
    const { beer, tab } = await setUp();
    await addTabItem(db, tab.id, beer, { qtyMilli: 1000 }, { deviceCode: 'K1' }, later(1));
    await sendTab(db, tab.id, later(2));
    await addTabItem(db, tab.id, beer, { qtyMilli: 1000 }, { deviceCode: 'P7' }, later(3));
    await sendTab(db, tab.id, later(4));
    const slips = await take(5);
    expect(slips.map((slip) => [slip.waiters, slip.devices])).toEqual([
      [[], ['Kasa 1']],
      [[], ['P7']],
    ]);
    expect(slips[0]).toMatchObject({ delivered: false, title: 'Masa 5' });
  });

  it('never prints again what it has had to forget past its ceiling', async () => {
    const { beer, tab } = await setUp();
    for (const minute of [1, 2, 3]) {
      await addTabItem(db, tab.id, beer, { qtyMilli: 1000 }, aliOnPhone, later(minute));
      await sendTab(db, tab.id, later(minute));
    }
    expect(await take(4, 'all', at, 2)).toHaveLength(3);
    expect((await db.meta.get('orderSlipsPrinted'))?.value).toHaveLength(2);
    // The oldest line fell off the record, and still does not come back.
    expect(await take(5, 'all', at, 2)).toEqual([]);
    expect(await take(6, 'all', at, 2)).toEqual([]);

    // A new order still prints.
    await addTabItem(db, tab.id, beer, { qtyMilli: 1000 }, aliOnPhone, later(7));
    await sendTab(db, tab.id, later(7));
    expect((await take(8, 'all', at, 2)).map((slip) => slip.sentAt)).toEqual([
      later(7).toISOString(),
    ]);
    expect(await take(9, 'all', at, 2)).toEqual([]);
  });

  it('keeps the latest slip printed, to print again by hand', async () => {
    const { beer, tab } = await setUp();
    expect(await lastSlip(db)).toBeNull();
    await addTabItem(db, tab.id, beer, { qtyMilli: 1000 }, aliOnPhone, later(1));
    await sendTab(db, tab.id, later(1));
    await addTabItem(db, tab.id, beer, { qtyMilli: 3000 }, aliOnPhone, later(2));
    await deliverTab(db, tab.id, later(2));
    const slips = await take(3);
    expect(await lastSlip(db)).toEqual(slips[1]);
    // A look that prints nothing keeps it.
    await take(4);
    expect((await lastSlip(db))?.lines[0]?.qtyMilli).toBe(3000);
  });

  it('remembers what it printed for a day only, and prints nothing older', async () => {
    const { beer, tab } = await setUp();
    await addTabItem(db, tab.id, beer, { qtyMilli: 1000 }, aliOnPhone, later(1));
    await sendTab(db, tab.id, later(2));
    expect(await take(3)).toHaveLength(1);
    expect((await db.meta.get('orderSlipsPrinted'))?.value).toHaveLength(1);

    // A day and more later the record is gone, and the old line is not printed again.
    const dayLater = 25 * 60;
    expect(await take(dayLater)).toEqual([]);
    expect((await db.meta.get('orderSlipsPrinted'))?.value).toEqual([]);
  });
});

describe('slipDateTime', () => {
  it('says the day and the time as the restaurant does, in Istanbul', () => {
    expect(slipDateTime('2026-11-22T18:05:00Z')).toEqual({ date: '22.11.2026', time: '21:05' });
  });
});
