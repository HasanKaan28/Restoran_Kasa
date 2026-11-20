import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openMarketDb, type MarketDb } from '@/data/db';
import { createProduct } from '@/data/products';
import {
  addTabItem,
  createDiningTable,
  markReady,
  openTab,
  recallLast,
  sendTab,
} from '@/data/restaurant';
import { isMine, noticeText, takeReadyNews, type Listener } from './readyNotices';

let name: string;
let db: MarketDb;
beforeEach(() => {
  name = `test-${crypto.randomUUID()}`;
  db = openMarketDb(name);
});
afterEach(async () => {
  await db.delete();
});

const at = new Date('2026-11-20T18:00:00Z');
const later = (minutes: number) => new Date(at.getTime() + minutes * 60_000);
const ayseOnK1 = { deviceCode: 'K1', staffId: 'ayse' };
const ayseHere: Listener = { deviceCode: 'K2', staffId: 'ayse' };
const KITCHEN = 'M1';

async function menu() {
  const kebab = await createProduct(
    db,
    { name: 'Adana kebap', sellPrice: 45000, vatRate: 10, station: 'kitchen' },
    at,
  );
  const ayran = await createProduct(
    db,
    { name: 'Ayran', sellPrice: 4000, vatRate: 10, station: 'bar' },
    at,
  );
  const water = await createProduct(
    db,
    { name: 'Su', sellPrice: 2000, vatRate: 1, station: 'none' },
    at,
  );
  return { kebab, ayran, water };
}

/** Table 5 with two kebabs (two lines) and an ayran, sent by Ayşe from K1. */
async function tableFive() {
  const { kebab, ayran, water } = await menu();
  const table = await createDiningTable(db, { name: '5', area: 'Salon' }, at);
  const tab = await openTab(db, { tableId: table.id, ...ayseOnK1 }, at);
  const first = await addTabItem(db, tab.id, kebab, { qtyMilli: 1000 }, ayseOnK1, at);
  const second = await addTabItem(db, tab.id, kebab, { qtyMilli: 1000 }, ayseOnK1, at);
  const drink = await addTabItem(db, tab.id, ayran, { qtyMilli: 1000 }, ayseOnK1, at);
  const glass = await addTabItem(db, tab.id, water, { qtyMilli: 1000 }, ayseOnK1, at);
  await sendTab(db, tab.id, later(1));
  return { tab, first, second, drink, glass };
}

const take = (me: Listener, minutes: number, options: Partial<{ scope: 'mine' | 'all' }> = {}) =>
  takeReadyNews(db, me, { scope: options.scope ?? 'mine', quiet: false, now: later(minutes) });

describe('takeReadyNews', () => {
  it('starts from what is ready already, so a first run announces nothing old', async () => {
    const { first } = await tableFive();
    await markReady(db, [first.id], later(2), KITCHEN);
    expect(await take(ayseHere, 3)).toEqual([]);
  });

  it('groups the lines that became ready together, one notice per table and station', async () => {
    const { tab, first, second, drink } = await tableFive();
    await take(ayseHere, 1);
    await markReady(db, [first.id, second.id], later(8), KITCHEN);
    await markReady(db, [drink.id], later(8), 'B1');

    const notices = await take(ayseHere, 9);
    expect(notices.map((notice) => [notice.station, noticeText(notice).sentence])).toEqual([
      ['kitchen', 'Masa 5 hazır: 2 × Adana kebap'],
      ['bar', 'Masa 5 hazır: 1 × Ayran'],
    ]);
    expect(notices[0]?.tabId).toBe(tab.id);
    expect([...(notices[0]?.itemIds ?? [])].sort()).toEqual([first.id, second.id].sort());
    expect(noticeText(notices[0]!)).toMatchObject({
      title: 'Masa 5 hazır',
      body: '2 × Adana kebap',
    });
  });

  it('names a takeaway order by its label', async () => {
    const { kebab } = await menu();
    const tab = await openTab(db, { label: 'Paket 3', ...ayseOnK1 }, at);
    const plate = await addTabItem(db, tab.id, kebab, { qtyMilli: 2000 }, ayseOnK1, at);
    await sendTab(db, tab.id, later(1));
    await take(ayseHere, 1);
    await markReady(db, [plate.id], later(5), KITCHEN);
    expect((await take(ayseHere, 5)).map((notice) => noticeText(notice).sentence)).toEqual([
      'Paket 3 hazır: 2 × Adana kebap',
    ]);
  });

  it('never announces a line twice, after a reload of the app either', async () => {
    const { first } = await tableFive();
    await take(ayseHere, 1);
    await markReady(db, [first.id], later(5), KITCHEN);
    expect(await take(ayseHere, 5)).toHaveLength(1);
    expect(await take(ayseHere, 6)).toEqual([]);

    db.close();
    db = openMarketDb(name);
    expect(await take(ayseHere, 7)).toEqual([]);
  });

  it('announces a line again when the kitchen took its "ready" back and marked it later', async () => {
    const { first } = await tableFive();
    await take(ayseHere, 1);
    await markReady(db, [first.id], later(5), KITCHEN);
    await take(ayseHere, 5);
    await recallLast(db, 'kitchen', later(6));
    await markReady(db, [first.id], later(9), KITCHEN);
    expect(await take(ayseHere, 9)).toHaveLength(1);
  });

  it('never tells a screen of the "ready" it marked itself', async () => {
    const { first } = await tableFive();
    const kitchen: Listener = { deviceCode: KITCHEN, staffId: null };
    await take(kitchen, 1, { scope: 'all' });
    await markReady(db, [first.id], later(5), KITCHEN);
    expect(await take(kitchen, 5, { scope: 'all' })).toEqual([]);
  });

  it('does not announce what needs no preparing (water is ready the moment it is sent)', async () => {
    const { glass } = await tableFive();
    expect((await db.tabItems.get(glass.id))?.status).toBe('ready');
    await take(ayseHere, 0);
    expect(await take(ayseHere, 2, { scope: 'all' })).toEqual([]);
  });

  it('tells only whose order it is, unless the device wants every ready line', async () => {
    // Ayşe's order, on the phone Mehmet is signed in on now.
    const { first, second } = await tableFive();
    const mehmetOnK1: Listener = { deviceCode: 'K1', staffId: 'mehmet' };
    await take(mehmetOnK1, 1);
    await markReady(db, [first.id], later(5), KITCHEN);
    expect(await take(mehmetOnK1, 5)).toEqual([]);
    await markReady(db, [second.id], later(6), KITCHEN);
    expect(await take(mehmetOnK1, 6, { scope: 'all' })).toHaveLength(1);
  });

  it('keeps quiet while asked to, and does not announce later what it kept quiet about', async () => {
    const { first } = await tableFive();
    await take(ayseHere, 1);
    await markReady(db, [first.id], later(5), KITCHEN);
    expect(
      await takeReadyNews(db, ayseHere, { scope: 'mine', quiet: true, now: later(5) }),
    ).toEqual([]);
    expect(await take(ayseHere, 6)).toEqual([]);
  });

  it('lets a line ready long ago pass without a word (a phone opened the next morning)', async () => {
    const { first } = await tableFive();
    await take(ayseHere, 1);
    await markReady(db, [first.id], later(5), KITCHEN);
    expect(await take(ayseHere, 30)).toEqual([]);
  });
});

describe('isMine', () => {
  const line = { deviceCode: 'K1', staffId: 'ayse' };

  it('follows the waiter to whichever device they are signed in on', () => {
    expect(isMine(line, { deviceCode: 'K2', staffId: 'ayse' })).toBe(true);
    expect(isMine(line, { deviceCode: 'K1', staffId: 'mehmet' })).toBe(false);
  });

  it('falls back to the device that took the order when nobody is signed in there', () => {
    expect(isMine(line, { deviceCode: 'K1', staffId: null })).toBe(true);
    expect(isMine(line, { deviceCode: 'K2', staffId: null })).toBe(false);
    expect(isMine({ deviceCode: 'K1' }, { deviceCode: 'K1', staffId: 'ayse' })).toBe(true);
  });
});
