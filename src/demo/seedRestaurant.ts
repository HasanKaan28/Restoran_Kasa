import { loadDeviceSettings } from '@/app/device';
import { createCategory } from '@/data/categories';
import { openMarketDb } from '@/data/db';
import { createProduct } from '@/data/products';
import {
  addTabItem,
  createDiningTable,
  markReady,
  openTab,
  sendTab,
  setComplimentary,
} from '@/data/restaurant';
import type { ProductRecord, Station } from '@/data/types';
import type { VatRate } from '@/domain/pricing';

type DemoDish = [name: string, category: string, price: number, vat: VatRate, station: Station];

const MENU: DemoDish[] = [
  ['Adana kebap', 'Izgara', 45000, 10, 'kitchen'],
  ['Urfa kebap', 'Izgara', 45000, 10, 'kitchen'],
  ['Kuzu şiş', 'Izgara', 52000, 10, 'kitchen'],
  ['Tavuk kanat', 'Izgara', 34000, 10, 'kitchen'],
  ['Izgara köfte', 'Izgara', 38000, 10, 'kitchen'],
  ['Mercimek çorbası', 'Çorba', 12000, 10, 'kitchen'],
  ['Ezme', 'Meze', 11000, 10, 'kitchen'],
  ['Haydari', 'Meze', 12000, 10, 'kitchen'],
  ['Humus', 'Meze', 13000, 10, 'kitchen'],
  ['Çoban salata', 'Meze', 14000, 10, 'kitchen'],
  ['Künefe', 'Tatlı', 18000, 10, 'kitchen'],
  ['Fırın sütlaç', 'Tatlı', 12000, 10, 'kitchen'],
  ['Rakı 35 cl', 'İçecek', 85000, 20, 'bar'],
  ['Şalgam', 'İçecek', 6000, 10, 'bar'],
  ['Ayran', 'İçecek', 5000, 10, 'bar'],
  ['Kola', 'İçecek', 6000, 20, 'bar'],
  ['Türk kahvesi', 'İçecek', 7000, 10, 'bar'],
  ['Çay', 'İçecek', 2500, 10, 'bar'],
  ['Su', 'İçecek', 2000, 1, 'none'],
];

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);

/**
 * Fills this browser's restaurant with a believable evening for screenshots: a menu by category,
 * tables in the salon and the garden, tabs open at some of them with lines sent, ready and a
 * treat. Development only (`await seedRestaurant()` in the console).
 */
export async function seedRestaurant(): Promise<string> {
  const settings = loadDeviceSettings();
  const db = openMarketDb(settings.databaseId ?? settings.marketId);
  if ((await db.diningTables.count()) > 0) {
    return 'Bu restoranda zaten masa var; önce tarayıcı verisini temizleyin.';
  }
  const at = minutesAgo(120);
  const categories = new Map<string, string>();
  const dishes = new Map<string, ProductRecord>();
  for (const [name, category, price, vat, station] of MENU) {
    if (!categories.has(category)) {
      categories.set(category, (await createCategory(db, category, at)).id);
    }
    dishes.set(
      name,
      await createProduct(
        db,
        {
          name,
          sellPrice: price,
          vatRate: vat,
          station,
          categoryId: categories.get(category),
          isQuick: true,
        },
        at,
      ),
    );
  }
  const tables = new Map<string, string>();
  for (const name of ['1', '2', '3', '4', '5', '6', '7', '8']) {
    tables.set(name, (await createDiningTable(db, { name, area: 'Salon' }, at)).id);
  }
  for (const name of ['B1', 'B2', 'B3', 'B4']) {
    tables.set(name, (await createDiningTable(db, { name, area: 'Bahçe' }, at)).id);
  }

  const waiter = { deviceCode: settings.deviceCode };
  const dish = (name: string) => dishes.get(name) as ProductRecord;
  type Line = [name: string, qty: number, note?: string];
  async function seat(
    table: string,
    minutes: number,
    sent: Line[],
    taking: Line[],
    ready: string[] = [],
  ) {
    const tab = await openTab(db, { tableId: tables.get(table), ...waiter }, minutesAgo(minutes));
    const ids = new Map<string, string>();
    for (const [name, qty, note] of sent) {
      const item = await addTabItem(
        db,
        tab.id,
        dish(name),
        { qtyMilli: qty * 1000, ...(note ? { note } : {}) },
        waiter,
        minutesAgo(minutes),
      );
      ids.set(name, item.id);
    }
    await sendTab(db, tab.id, minutesAgo(minutes - 1));
    await markReady(
      db,
      ready.map((name) => ids.get(name) as string),
      minutesAgo(Math.max(1, minutes - 10)),
    );
    for (const [name, qty, note] of taking) {
      await addTabItem(
        db,
        tab.id,
        dish(name),
        { qtyMilli: qty * 1000, ...(note ? { note } : {}) },
        waiter,
        minutesAgo(1),
      );
    }
    return { tab, ids };
  }

  await seat(
    '1',
    48,
    [
      ['Rakı 35 cl', 1],
      ['Ezme', 1],
      ['Haydari', 1],
      ['Çoban salata', 1],
      ['Adana kebap', 2, 'Biri acısız'],
      ['Su', 2],
    ],
    [],
    ['Rakı 35 cl', 'Ezme', 'Haydari', 'Çoban salata', 'Su'],
  );
  const three = await seat(
    '3',
    22,
    [
      ['Mercimek çorbası', 2],
      ['Urfa kebap', 1],
      ['Izgara köfte', 1, 'Az pişmiş'],
      ['Ayran', 2],
    ],
    [],
    ['Mercimek çorbası', 'Ayran'],
  );
  await setComplimentary(db, three.ids.get('Ayran') as string, true, minutesAgo(5));
  await seat(
    '5',
    9,
    [
      ['Kuzu şiş', 2],
      ['Tavuk kanat', 1],
      ['Şalgam', 3],
    ],
    [],
  );
  await seat(
    'B2',
    31,
    [
      ['Künefe', 2],
      ['Türk kahvesi', 2, 'Orta şekerli'],
    ],
    [],
    ['Türk kahvesi'],
  );
  await seat(
    'B4',
    3,
    [],
    [
      ['Humus', 1],
      ['Kola', 2],
    ],
  );
  return 'Restoran örnek verisi yüklendi.';
}
