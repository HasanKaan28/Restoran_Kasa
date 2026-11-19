// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestServer, type TestServer } from './harness';

type MenuState = { enabled: boolean; slug: string | null };
type PublicMenu = {
  name: string;
  categories: { id: string; name: string }[];
  dishes: {
    name: string;
    price: number;
    categoryId?: string;
    description?: string;
    portions?: { label: string; price: number }[];
    options?: { name: string; choices: string[] }[];
  }[];
};

let server: TestServer;
let seq = 0;

beforeEach(async () => {
  server = await createTestServer();
  await server.addMarket('a', 'Kebapçı Halil');
  await server.addMarket('b', 'B Lokanta');
});

const errorOf = (promise: Promise<unknown>) =>
  promise.then(
    () => 'no error',
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );

const at = '2026-11-20T09:00:00.000Z';

/** Writes records the way a register does: through sync_push, as that register. */
async function push(
  deviceUser: string,
  rows: [table: string, record: { id: string } & Record<string, unknown>][],
) {
  await server.as(deviceUser).rpc('sync_push', [
    rows.map(([table, record]) => ({
      kind: 'insert',
      table,
      recordId: record.id,
      record,
      seq: ++seq,
      opId: crypto.randomUUID(),
      createdAt: at,
    })),
  ]);
}

const product = (id: string, fields: Record<string, unknown>) => ({
  id,
  unit: 'piece',
  buyPrice: 12000,
  vatRate: 10,
  isQuick: false,
  criticalLevelMilli: 0,
  station: 'kitchen',
  createdAt: at,
  updatedAt: at,
  ...fields,
});

/** A market with a menu, the kitchen's private fields included, and a till's records. */
async function seedMenu(market = 'a') {
  const { userId } = await server.addDevice(market, 'K1');
  await push(userId, [
    ['categories', { id: 'c-izgara', name: 'Izgara', sort: 1, createdAt: at, updatedAt: at }],
    ['categories', { id: 'c-corba', name: 'Çorbalar', sort: 0, createdAt: at, updatedAt: at }],
    [
      'categories',
      { id: 'c-eski', name: 'Eski', sort: 2, createdAt: at, updatedAt: at, deletedAt: at },
    ],
    [
      'products',
      product('p-adana', {
        name: 'Adana kebap',
        categoryId: 'c-izgara',
        sellPrice: 45000,
        barcode: '8690000000001',
        packs: [{ barcode: '8690000000002', qtyMilli: 6000 }],
        packCodes: ['8690000000002'],
        portions: [{ label: 'Yarım', price: 25000 }],
        optionGroups: [{ name: 'Acı', choices: ['Acılı', 'Acısız'], required: true }],
      }),
    ],
    [
      'products',
      product('p-mercimek', {
        name: 'Mercimek çorbası',
        categoryId: 'c-corba',
        sellPrice: 12000,
        description: 'Limon ve kıtır ekmekle',
      }),
    ],
    ['products', product('p-ayran', { name: 'Ayran', sellPrice: 5000 })],
    // Its category was deleted: the dish stays, without a section of its own.
    ['products', product('p-sutlac', { name: 'Sütlaç', categoryId: 'c-eski', sellPrice: 9000 })],
    [
      'products',
      product('p-sildi', {
        name: 'Kaldırılan',
        categoryId: 'c-izgara',
        sellPrice: 1,
        deletedAt: at,
      }),
    ],
    [
      'staff',
      {
        id: 's1',
        name: 'Halil',
        role: 'owner',
        pinHash: 'hash',
        pinSalt: 'salt',
        pinIterations: 1,
        createdAt: at,
        updatedAt: at,
      },
    ],
    [
      'sales',
      { id: 'sale-1', receiptNo: 'K1-1', total: 45000, lines: [], payments: [], occurredAt: at },
    ],
  ]);
  return userId;
}

describe('the QR menu', () => {
  it('shows a guest only the restaurant name and its live menu', async () => {
    await seedMenu();
    const owner = await server.addOwner('a');
    const state = await server.as(owner).rpc<MenuState>('set_qr_menu', ['a', true]);
    expect(state.enabled).toBe(true);
    expect(state.slug).toMatch(/^[0-9A-Za-z]{22,64}$/);

    const menu = await server.as(null).rpc<PublicMenu>('public_menu', [state.slug]);
    expect(menu).toEqual({
      name: 'Kebapçı Halil',
      categories: [
        { id: 'c-corba', name: 'Çorbalar' },
        { id: 'c-izgara', name: 'Izgara' },
      ],
      dishes: [
        {
          name: 'Adana kebap',
          price: 45000,
          categoryId: 'c-izgara',
          portions: [{ label: 'Yarım', price: 25000 }],
          options: [{ name: 'Acı', choices: ['Acılı', 'Acısız'] }],
        },
        { name: 'Ayran', price: 5000 },
        {
          name: 'Mercimek çorbası',
          price: 12000,
          categoryId: 'c-corba',
          description: 'Limon ve kıtır ekmekle',
        },
        { name: 'Sütlaç', price: 9000 },
      ],
    });
    // Nothing the kitchen keeps to itself: no costs, codes, stock levels, staff or sales.
    const text = JSON.stringify(menu);
    for (const secret of ['buyPrice', '869000000000', 'kitchen', 'vatRate', 'p-adana', 'sale-1']) {
      expect(text, secret).not.toContain(secret);
    }
    expect(text).not.toContain('"Halil"');

    // A signed-in session sees the same, and only through the function.
    const someone = await server.addUser({ email: 'misafir@example.com' });
    expect(await server.as(someone).rpc('public_menu', [state.slug])).toEqual(menu);
    expect(await errorOf(server.as(null).query('select * from app.qr_menus'))).toContain(
      'permission denied',
    );
    expect(await errorOf(server.as(someone).query('select * from app.rows'))).toContain(
      'permission denied',
    );
  });

  it('answers null alike for an unknown, malformed or turned-off link', async () => {
    await seedMenu();
    const owner = await server.addOwner('a');
    const { slug } = await server.as(owner).rpc<MenuState>('set_qr_menu', ['a', true]);

    expect(await server.as(null).rpc('public_menu', ['A'.repeat(28)])).toBeNull();
    expect(await server.as(null).rpc('public_menu', ['kısa'])).toBeNull();
    expect(await server.as(null).rpc('public_menu', [null])).toBeNull();
    expect(await server.as(null).rpc('public_menu', [`${slug}'; select 1; --`])).toBeNull();

    const off = await server.as(owner).rpc<MenuState>('set_qr_menu', ['a', false]);
    expect(off).toEqual({ enabled: false, slug });
    expect(await server.as(null).rpc('public_menu', [slug])).toBeNull();

    // Turned back on, the same link (and the cards already printed) work again.
    await server.as(owner).rpc('set_qr_menu', ['a', true]);
    expect(await server.as(null).rpc<PublicMenu>('public_menu', [slug])).toMatchObject({
      name: 'Kebapçı Halil',
    });
    // A suspended restaurant shows no menu.
    await server.query("update app.markets set status = 'suspended' where id = 'a'");
    expect(await server.as(null).rpc('public_menu', [slug])).toBeNull();
  });

  it('lets only the owner turn it on or off and make a new link', async () => {
    const owner = await server.addOwner('a');
    const otherOwner = await server.addOwner('b');
    const manager = await server.addUser({ email: 'mudur@example.com' });
    await server.query(
      "insert into app.memberships (market_id, user_id, role) values ('a', $1, 'manager')",
      [manager],
    );
    const anonymous = await server.addUser({ anonymous: true });
    const { userId: register } = await server.addDevice('a', 'K1');

    for (const caller of [otherOwner, manager, anonymous, register]) {
      expect(await errorOf(server.as(caller).rpc('set_qr_menu', ['a', true]))).toContain(
        'not_owner',
      );
      expect(await errorOf(server.as(caller).rpc('rotate_qr_menu', ['a']))).toContain('not_owner');
    }
    expect(await errorOf(server.as(null).rpc('set_qr_menu', ['a', true]))).toContain(
      'permission denied',
    );
    expect(await errorOf(server.as(null).rpc('rotate_qr_menu', ['a']))).toContain(
      'permission denied',
    );
    expect(await server.query('select * from app.qr_menus')).toEqual([]);

    expect((await server.as(owner).rpc<MenuState>('set_qr_menu', ['a', true])).enabled).toBe(true);
    expect(await errorOf(server.as(owner).rpc('set_qr_menu', ['a', null]))).toContain(
      'bad_request',
    );
  });

  it('makes a new link that retires the old one', async () => {
    await seedMenu();
    const owner = await server.addOwner('a');
    const first = await server.as(owner).rpc<MenuState>('set_qr_menu', ['a', true]);
    const second = await server.as(owner).rpc<MenuState>('rotate_qr_menu', ['a']);

    expect(second.enabled).toBe(true);
    expect(second.slug).toMatch(/^[0-9A-Za-z]{22,64}$/);
    expect(second.slug).not.toBe(first.slug);
    expect(await server.as(null).rpc('public_menu', [first.slug])).toBeNull();
    expect(await server.as(null).rpc<PublicMenu>('public_menu', [second.slug])).toMatchObject({
      name: 'Kebapçı Halil',
    });

    // A link made while the menu is off stays off until it is turned on.
    const other = await server.addOwner('b');
    const fresh = await server.as(other).rpc<MenuState>('rotate_qr_menu', ['b']);
    expect(fresh.enabled).toBe(false);
    expect(await server.as(null).rpc('public_menu', [fresh.slug])).toBeNull();
  });

  it("tells each register its own restaurant's link", async () => {
    const { userId: registerA } = await server.addDevice('a', 'K1');
    const { userId: registerB } = await server.addDevice('b', 'K1');
    expect(await server.as(registerA).rpc('my_qr_menu')).toEqual({ enabled: false, slug: null });

    const owner = await server.addOwner('a');
    const state = await server.as(owner).rpc<MenuState>('set_qr_menu', ['a', true]);
    expect(await server.as(registerA).rpc('my_qr_menu')).toEqual(state);
    expect(await server.as(registerB).rpc('my_qr_menu')).toEqual({ enabled: false, slug: null });

    expect(await errorOf(server.as(null).rpc('my_qr_menu'))).toContain('permission denied');
    expect(await errorOf(server.as(owner).rpc('my_qr_menu'))).toContain('device_not_registered');
  });

  it('keeps the answer small whatever a register wrote', async () => {
    const { userId } = await server.addDevice('a', 'K1');
    const many = Array.from({ length: 40 }, (_, index) => ({ label: `P${index}`, price: index }));
    await push(userId, [
      [
        'products',
        product('p-big', {
          name: `${'Çok uzun ad '.repeat(30)}`,
          description: 'x'.repeat(2000),
          sellPrice: 100,
          portions: [...many, { label: 'bozuk', price: 'yüz' }, 'metin'],
          optionGroups: Array.from({ length: 40 }, (_, index) => ({
            name: `Seçim ${index}`,
            choices: Array.from({ length: 60 }, (__, choice) => `S${choice}`),
          })),
        }),
      ],
      // Records no register would write are left out rather than break the menu.
      ['products', product('p-no-price', { name: 'Fiyatsız' })],
      ['products', product('p-no-name', { name: '  ', sellPrice: 100 })],
      ['products', product('p-huge', { name: 'Taşkın', sellPrice: 1e30 })],
    ]);
    const owner = await server.addOwner('a');
    const { slug } = await server.as(owner).rpc<MenuState>('set_qr_menu', ['a', true]);
    const menu = await server.as(null).rpc<PublicMenu>('public_menu', [slug]);

    expect(menu.dishes).toHaveLength(1);
    const [dish] = menu.dishes;
    expect(dish?.name.length).toBeLessThanOrEqual(80);
    expect(dish?.description?.length).toBeLessThanOrEqual(300);
    expect(dish?.portions?.length).toBeLessThanOrEqual(12);
    expect(dish?.options?.length).toBeLessThanOrEqual(12);
    expect(dish?.options?.[0]?.choices.length).toBeLessThanOrEqual(24);
  });
});
