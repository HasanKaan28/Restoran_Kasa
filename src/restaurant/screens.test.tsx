import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProduct } from '@/data/products';
import {
  addTabItem,
  createDiningTable,
  kitchenTickets,
  listDiningTables,
  openTab,
  openTabs,
  payTabAmount,
  sendTab,
} from '@/data/restaurant';
import { expectedCash } from '@/data/cash';
import { saveServerLicense } from '@/data/license';
import { recentSales } from '@/data/sales';
import { createStaff } from '@/data/staff';
import { SessionProvider } from '@/app/SessionProvider';
import { createTestData, disposeTestData, renderWithData } from '@/test/renderWithData';
import { signInAs } from '@/test/session';
import { KitchenScreen } from './KitchenScreen';
import { MoveDialog } from './MoveDialog';
import { TablesScreen } from './TablesScreen';
import { TablesSection } from './TablesSection';

afterEach(async () => {
  localStorage.clear();
  await disposeTestData();
});

async function restaurant() {
  const data = createTestData();
  const at = new Date();
  await createDiningTable(data.db, { name: 'S1', area: 'Salon' }, at);
  await createProduct(
    data.db,
    { name: 'Adana kebap', sellPrice: 45000, vatRate: 10, station: 'kitchen' },
    at,
  );
  await createProduct(data.db, { name: 'Ayran', sellPrice: 4000, vatRate: 1, station: 'bar' }, at);
  return data;
}

describe('the waiter’s floor', () => {
  it('keeps every open tab within reach, even two on one table or one on a removed table', async () => {
    const data = await restaurant();
    const [s1] = await listDiningTables(data.db);
    const s2 = await createDiningTable(data.db, { name: 'S2', area: 'Salon' }, new Date());
    const gone = await createDiningTable(data.db, { name: 'B9', area: 'Bahçe' }, new Date());
    const kebab = await data.db.products.filter((one) => one.name === 'Adana kebap').first();
    const ayran = await data.db.products.filter((one) => one.name === 'Ayran').first();
    const waiter = { deviceCode: 'K1' };
    const first = await openTab(data.db, { tableId: s1!.id, ...waiter }, new Date());
    await addTabItem(data.db, first.id, kebab!, { qtyMilli: 1000 }, waiter, new Date());
    // Two registers opened S1 before either heard of the other's tab, as sync brings it in.
    const second = await openTab(data.db, { tableId: s2.id, ...waiter }, new Date());
    await addTabItem(data.db, second.id, ayran!, { qtyMilli: 1000 }, waiter, new Date());
    await data.db.tabs.update(second.id, { tableId: s1!.id });
    // A table taken out of use on another register while its tab was open there.
    const third = await openTab(data.db, { tableId: gone.id, ...waiter }, new Date());
    await addTabItem(data.db, third.id, ayran!, { qtyMilli: 2000 }, waiter, new Date());
    await data.db.diningTables.update(gone.id, { archivedAt: new Date().toISOString() });
    await renderWithData(<TablesScreen />, data);

    expect(await screen.findByRole('button', { name: 'S1, dolu, ₺450,00' })).toBeInTheDocument();
    const others = await screen.findByRole('region', { name: 'Diğer açık adisyonlar' });
    expect(within(others).getByRole('button', { name: 'S1 · ₺40,00' })).toBeInTheDocument();
    await userEvent.click(within(others).getByRole('button', { name: 'B9 · ₺80,00' }));
    expect(await screen.findByRole('heading', { name: 'B9', level: 1 })).toBeInTheDocument();
  });

  it('shows open takeaway orders above the tables, so a phone reaches them at once', async () => {
    const data = await restaurant();
    for (let n = 2; n <= 12; n += 1) {
      await createDiningTable(data.db, { name: `S${n}`, area: 'Salon' }, new Date());
    }
    const ayran = await data.db.products.filter((one) => one.name === 'Ayran').first();
    const waiter = { deviceCode: 'K1' };
    const paket = await openTab(data.db, { label: 'Paket 1', ...waiter }, new Date());
    await addTabItem(data.db, paket.id, ayran!, { qtyMilli: 1000 }, waiter, new Date());
    await renderWithData(<TablesScreen />, data);

    const takeaway = await screen.findByRole('region', { name: 'Paket siparişler' });
    const tables = screen.getByRole('list', { name: 'Masalar' });
    expect(
      takeaway.compareDocumentPosition(tables) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(within(takeaway).getByRole('button', { name: 'Paket 1 · ₺40,00' })).toBeInTheDocument();
  });

  it('closes a table left with nothing ordered, but not one another register opened', async () => {
    const data = await restaurant();
    const s2 = await createDiningTable(data.db, { name: 'S2', area: 'Salon' }, new Date());
    // S2 was opened on the bar's register (K2), whose waiter may be ordering on it right now.
    const theirs = await openTab(data.db, { tableId: s2.id, deviceCode: 'K2' }, new Date());
    await renderWithData(<TablesScreen />, data);

    await userEvent.click(await screen.findByRole('button', { name: 'S1, boş' }));
    await screen.findByRole('region', { name: 'Menü' });
    await userEvent.click(screen.getByRole('button', { name: 'Masalar' }));
    expect(await screen.findByRole('button', { name: 'S1, boş' })).toBeInTheDocument();

    await userEvent.click(await screen.findByRole('button', { name: 'S2, dolu, ₺0,00' }));
    await screen.findByRole('region', { name: 'Menü' });
    await userEvent.click(screen.getByRole('button', { name: 'Masalar' }));
    await screen.findByRole('button', { name: 'S2, dolu, ₺0,00' });
    expect((await data.db.tabs.get(theirs.id))?.status).toBe('open');
  });

  it('takes an order at a table, sends it, and takes the payment', async () => {
    const data = await restaurant();
    await renderWithData(<TablesScreen />, data);

    await userEvent.click(await screen.findByRole('button', { name: 'S1, boş' }));
    const menu = await screen.findByRole('region', { name: 'Menü' });
    await userEvent.click(await within(menu).findByRole('button', { name: /Adana kebap/ }));
    await userEvent.click(within(menu).getByRole('button', { name: /Adana kebap/ }));
    await userEvent.click(within(menu).getByRole('button', { name: /Ayran/ }));
    const order = screen.getByRole('region', { name: 'Adisyon' });
    expect(await within(order).findByText('2 · Gönderilmedi')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Kalan tutar')).toHaveTextContent('₺940,00'));

    await userEvent.click(await screen.findByRole('button', { name: 'Mutfağa gönder (2)' }));
    await waitFor(async () => expect(await kitchenTickets(data.db, 'kitchen')).toHaveLength(1));
    expect(await kitchenTickets(data.db, 'bar')).toHaveLength(1);

    await userEvent.click(screen.getByRole('button', { name: 'Hesap' }));
    const bill = await screen.findByRole('dialog', { name: 'Hesap' });
    await userEvent.click(await within(bill).findByRole('radio', { name: 'Kart' }));
    await userEvent.click(within(bill).getByRole('button', { name: 'Ödemeyi al' }));

    // Paid: back on the floor, the table empty, and the sale on record.
    expect(await screen.findByRole('button', { name: 'S1, boş' })).toBeInTheDocument();
    expect(await recentSales(data.db)).toMatchObject([{ total: 94000 }]);
  });

  it('splits the bill by what each person had', async () => {
    const data = await restaurant();
    await renderWithData(<TablesScreen />, data);
    await userEvent.click(await screen.findByRole('button', { name: 'S1, boş' }));
    const menu = await screen.findByRole('region', { name: 'Menü' });
    await userEvent.click(await within(menu).findByRole('button', { name: /Adana kebap/ }));
    await userEvent.click(within(menu).getByRole('button', { name: /Ayran/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Mutfağa gönder (2)' }));
    await userEvent.click(screen.getByRole('button', { name: 'Hesap' }));
    const bill = await screen.findByRole('dialog', { name: 'Hesap' });
    await userEvent.click(await within(bill).findByRole('checkbox', { name: /Adana kebap/ }));
    await waitFor(() =>
      expect(within(bill).getByLabelText('Ödenecek tutar')).toHaveTextContent('₺40,00'),
    );
    await userEvent.click(within(bill).getByRole('button', { name: 'Ödemeyi al' }));

    // The kebab is still to pay: the tab stays open.
    await waitFor(() => expect(screen.getByLabelText('Kalan tutar')).toHaveTextContent('₺450,00'));
    expect(await recentSales(data.db)).toMatchObject([{ total: 4000 }]);
  });

  it('takes the payment of the lines chosen when tapped before the amount shows', async () => {
    const data = await restaurant();
    await renderWithData(<TablesScreen />, data);
    await userEvent.click(await screen.findByRole('button', { name: 'S1, boş' }));
    const menu = await screen.findByRole('region', { name: 'Menü' });
    await userEvent.click(await within(menu).findByRole('button', { name: /Adana kebap/ }));
    await userEvent.click(within(menu).getByRole('button', { name: /Ayran/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Mutfağa gönder (2)' }));
    await userEvent.click(screen.getByRole('button', { name: 'Hesap' }));
    const bill = await screen.findByRole('dialog', { name: 'Hesap' });
    // The amount below is worked out after the window opens, and again after every tick: a
    // waiter's quick tap must pay the lines ticked, not the figure the screen last had.
    const kebab = await within(bill).findByRole('checkbox', { name: /Adana kebap/ });
    fireEvent.click(kebab);
    fireEvent.click(within(bill).getByRole('button', { name: 'Ödemeyi al' }));

    await waitFor(async () => expect(await recentSales(data.db)).toMatchObject([{ total: 4000 }]));
    expect(within(bill).queryByRole('alert')).toBeNull();
  });

  it('shares the bill by heads to the kuruş, and drops a cash error once it is put right', async () => {
    const data = await restaurant();
    await renderWithData(<TablesScreen />, data);
    await userEvent.click(await screen.findByRole('button', { name: 'S1, boş' }));
    const menu = await screen.findByRole('region', { name: 'Menü' });
    await userEvent.click(await within(menu).findByRole('button', { name: /Adana kebap/ }));
    await userEvent.click(within(menu).getByRole('button', { name: /Ayran/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Mutfağa gönder (2)' }));
    await userEvent.click(screen.getByRole('button', { name: 'Hesap' }));
    const bill = await screen.findByRole('dialog', { name: 'Hesap' });
    await waitFor(() =>
      expect(within(bill).getByLabelText('Ödenecek tutar')).toHaveTextContent('₺490,00'),
    );

    // ₺490 by three is not even: three shares of ₺163,34 would take ₺490,02.
    await userEvent.type(within(bill).getByLabelText('Kişi sayısı'), '3');
    expect(within(bill).getByText('Kişi başı ₺163,33 · 1 kişi ₺163,34')).toBeInTheDocument();

    await userEvent.type(within(bill).getByLabelText('Alınan'), '400');
    await userEvent.click(within(bill).getByRole('button', { name: 'Ödemeyi al' }));
    expect(await within(bill).findByRole('alert')).toHaveTextContent('Alınan para tutardan az.');
    await userEvent.clear(within(bill).getByLabelText('Alınan'));
    await userEvent.type(within(bill).getByLabelText('Alınan'), '500');
    expect(within(bill).queryByRole('alert')).toBeNull();
    expect(within(bill).getByText('Para üstü ₺10,00')).toBeInTheDocument();
  });
});

/** A table with Adana kebap and Ayran sent, its bill of ₺490 open. */
async function billOf490() {
  const data = await restaurant();
  await renderWithData(<TablesScreen />, data);
  await userEvent.click(await screen.findByRole('button', { name: 'S1, boş' }));
  const menu = await screen.findByRole('region', { name: 'Menü' });
  await userEvent.click(await within(menu).findByRole('button', { name: /Adana kebap/ }));
  await userEvent.click(within(menu).getByRole('button', { name: /Ayran/ }));
  await userEvent.click(await screen.findByRole('button', { name: 'Mutfağa gönder (2)' }));
  await userEvent.click(screen.getByRole('button', { name: 'Hesap' }));
  const bill = await screen.findByRole('dialog', { name: 'Hesap' });
  await waitFor(() =>
    expect(within(bill).getByLabelText('Ödenecek tutar')).toHaveTextContent('₺490,00'),
  );
  return { data, bill };
}
describe('paying part in cash and the rest by card', () => {
  it('takes the cash part, the card the rest, as one receipt the till counts right', async () => {
    const { data, bill } = await billOf490();
    await userEvent.click(within(bill).getByRole('radio', { name: 'Nakit+Kart' }));
    await userEvent.type(within(bill).getByLabelText('Nakit kısmı'), '200');
    expect(within(bill).getByText('Kartla ₺290,00')).toBeInTheDocument();
    await userEvent.type(within(bill).getByLabelText('Alınan'), '250');
    expect(within(bill).getByText('Para üstü ₺50,00')).toBeInTheDocument();
    await userEvent.click(within(bill).getByRole('button', { name: 'Ödemeyi al' }));

    expect(await screen.findByRole('button', { name: 'S1, boş' })).toBeInTheDocument();
    expect(await recentSales(data.db)).toMatchObject([
      {
        total: 49000,
        payments: [
          { method: 'cash', amount: 20000 },
          { method: 'card', amount: 29000 },
        ],
        cashGiven: 25000,
        change: 5000,
      },
    ]);
    // The drawer expects the cash part only.
    expect((await expectedCash(data.db, 'K1')).sales).toBe(20000);
  });

  it('asks for a cash part below the bill, and for a readable amount given', async () => {
    const { data, bill } = await billOf490();
    await userEvent.click(within(bill).getByRole('radio', { name: 'Nakit+Kart' }));
    await userEvent.type(within(bill).getByLabelText('Nakit kısmı'), '490');
    await userEvent.click(within(bill).getByRole('button', { name: 'Ödemeyi al' }));
    expect(await within(bill).findByRole('alert')).toHaveTextContent(
      'Nakit kısmı ödenecek tutardan az olmalı',
    );

    await userEvent.click(within(bill).getByRole('radio', { name: 'Nakit' }));
    await userEvent.type(within(bill).getByLabelText('Alınan'), '500..');
    await userEvent.click(within(bill).getByRole('button', { name: 'Ödemeyi al' }));
    expect(await within(bill).findByRole('alert')).toHaveTextContent(
      'Alınan tutarı rakamla girin.',
    );
    expect(await recentSales(data.db)).toEqual([]);
  });
});

describe('paying one guest’s share by amount', () => {
  it('shows on the floor what is left once a share is paid', async () => {
    const data = await restaurant();
    const [table] = await listDiningTables(data.db);
    const tab = await openTab(data.db, { tableId: table!.id, deviceCode: 'K1' }, new Date());
    const kebab = await data.db.products.filter((one) => one.name === 'Adana kebap').first();
    await addTabItem(data.db, tab.id, kebab!, { qtyMilli: 1000 }, { deviceCode: 'K1' }, new Date());
    await sendTab(data.db, tab.id, new Date());
    await payTabAmount(
      data.db,
      { tabId: tab.id, method: 'card', amount: 15000, deviceCode: 'K1' },
      new Date(),
    );
    await renderWithData(<TablesScreen />, data);
    expect(await screen.findByRole('button', { name: 'S1, dolu, ₺300,00' })).toBeInTheDocument();
  });

  it('takes shares, shows what is left, and closes the table on the last one', async () => {
    const { data, bill } = await billOf490();
    await userEvent.click(within(bill).getByRole('radio', { name: 'Tutar ile öde' }));
    expect(within(bill).getByLabelText('Kalan')).toHaveTextContent('₺490,00');

    await userEvent.type(within(bill).getByLabelText('Tutar'), '200');
    await userEvent.type(within(bill).getByLabelText('Alınan'), '250');
    expect(within(bill).getByText('Para üstü ₺50,00')).toBeInTheDocument();
    await userEvent.click(within(bill).getByRole('button', { name: 'Ödemeyi al' }));
    expect(await within(bill).findByText('₺200,00 alındı. Kalan ₺290,00.')).toBeInTheDocument();
    await waitFor(() => expect(within(bill).getByLabelText('Kalan')).toHaveTextContent('₺290,00'));
    expect(within(bill).getByLabelText('Tutar')).toHaveValue('');
    expect((await expectedCash(data.db, 'K1')).sales).toBe(20000);

    await userEvent.type(within(bill).getByLabelText('Tutar'), '300');
    await userEvent.click(within(bill).getByRole('button', { name: 'Ödemeyi al' }));
    expect(await within(bill).findByRole('alert')).toHaveTextContent('Kalan ₺290,00');

    await userEvent.click(within(bill).getByRole('button', { name: 'Kalanı yaz' }));
    await userEvent.click(within(bill).getByRole('radio', { name: 'Kart' }));
    await userEvent.click(within(bill).getByRole('button', { name: 'Ödemeyi al' }));
    expect(await screen.findByRole('button', { name: 'S1, boş' })).toBeInTheDocument();
    expect(await recentSales(data.db)).toMatchObject([
      {
        total: 49000,
        payments: [
          { method: 'cash', amount: 20000, tabPaymentId: expect.any(String) },
          { method: 'card', amount: 29000 },
        ],
      },
    ]);
    expect((await expectedCash(data.db, 'K1')).sales).toBe(20000);
  });

  it('gives a share back', async () => {
    const { bill } = await billOf490();
    await userEvent.click(within(bill).getByRole('radio', { name: 'Tutar ile öde' }));
    await userEvent.type(within(bill).getByLabelText('Tutar'), '100');
    await userEvent.click(within(bill).getByRole('button', { name: 'Ödemeyi al' }));
    const taken = await within(bill).findByRole('list', { name: 'Alınan ödemeler' });
    await userEvent.click(within(taken).getByRole('button', { name: 'Geri ver: Nakit ₺100,00' }));
    await waitFor(() => expect(within(bill).getByLabelText('Kalan')).toHaveTextContent('₺490,00'));
    expect(within(bill).queryByRole('list', { name: 'Alınan ödemeler' })).toBeNull();
  });
});

describe('moving and merging tabs', () => {
  it('merges into a table with its own tab only once the waiter confirms', async () => {
    const data = await restaurant();
    const s2 = await createDiningTable(data.db, { name: 'S2', area: 'Salon' }, new Date());
    const [s1] = await listDiningTables(data.db);
    const kebab = await data.db.products.filter((one) => one.name === 'Adana kebap').first();
    for (const table of [s1!, s2]) {
      const tab = await openTab(data.db, { tableId: table.id, deviceCode: 'K1' }, new Date());
      await addTabItem(
        data.db,
        tab.id,
        kebab!,
        { qtyMilli: 1000 },
        { deviceCode: 'K1' },
        new Date(),
      );
    }
    await renderWithData(<TablesScreen />, data);

    await userEvent.click(await screen.findByRole('button', { name: 'S1, dolu, ₺450,00' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Taşı / birleştir' }));
    const move = await screen.findByRole('dialog', { name: 'Taşı / birleştir' });
    await userEvent.click(await within(move).findByRole('button', { name: 'S2 (dolu)' }));

    // A merge cannot be undone: one stray tap must not join two tables' bills.
    expect(await within(move).findByText(/Bu adisyon S2 ile birleşsin mi\?/)).toBeInTheDocument();
    expect(await openTabs(data.db)).toHaveLength(2);
    await userEvent.click(within(move).getByRole('button', { name: 'Vazgeç' }));
    await userEvent.click(await within(move).findByRole('button', { name: 'S2 (dolu)' }));
    await userEvent.click(within(move).getByRole('button', { name: 'Birleştir' }));

    await waitFor(async () => expect(await openTabs(data.db)).toHaveLength(1));
  });
});

describe('a waiter asking for a treat or a void', () => {
  it('gets a manager’s PIN instead of a dead button', async () => {
    const data = await restaurant();
    const before = new Date(Date.now() - 60_000);
    await createStaff(data.db, { name: 'Mert', role: 'owner', pin: '1234' }, before);
    await createStaff(data.db, { name: 'Zeynep', role: 'manager', pin: '4444' }, before);
    const ali = await createStaff(data.db, { name: 'Ali', role: 'cashier', pin: '2222' }, before);
    await signInAs(data.db, ali.id);
    const [table] = await listDiningTables(data.db);
    const tab = await openTab(data.db, { tableId: table!.id, deviceCode: 'K1' }, new Date());
    const kebab = await data.db.products.filter((one) => one.name === 'Adana kebap').first();
    await addTabItem(data.db, tab.id, kebab!, { qtyMilli: 1000 }, { deviceCode: 'K1' }, new Date());
    await sendTab(data.db, tab.id, new Date());
    await renderWithData(
      <SessionProvider>
        <TablesScreen />
      </SessionProvider>,
      data,
    );

    await userEvent.click(await screen.findByRole('button', { name: 'S1, dolu, ₺450,00' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Adana kebap: işlemler' }));
    const line = await screen.findByRole('dialog', { name: 'Adana kebap' });
    await userEvent.click(within(line).getByRole('button', { name: 'İkram' }));

    const approval = await screen.findByRole('dialog', { name: 'Yetkili onayı' });
    await within(approval).findByRole('option', { name: 'Zeynep · Yönetici' });
    await userEvent.selectOptions(
      within(approval).getByLabelText('Onaylayan'),
      'Zeynep · Yönetici',
    );
    await userEvent.type(within(approval).getByLabelText('PIN'), '4444');
    await userEvent.click(within(approval).getByRole('button', { name: 'Onayla' }));

    await waitFor(async () =>
      expect(await data.db.tabItems.where('tabId').equals(tab.id).toArray()).toMatchObject([
        { complimentary: true },
      ]),
    );
  });
});

describe('a licence past its grace', () => {
  it('takes no new order, and still lets the table pay what it has had', async () => {
    const data = await restaurant();
    const [table] = await listDiningTables(data.db);
    const tab = await openTab(data.db, { tableId: table!.id, deviceCode: 'K1' }, new Date());
    const kebab = await data.db.products.filter((one) => one.name === 'Adana kebap').first();
    await addTabItem(data.db, tab.id, kebab!, { qtyMilli: 1000 }, { deviceCode: 'K1' }, new Date());
    await sendTab(data.db, tab.id, new Date());
    // Ended a month ago: the seven days of grace are long over (DESIGN §8.6).
    const ended = new Date(Date.now() - 30 * 86_400_000).toISOString();
    await saveServerLicense(data.db, {
      plan: 'restoran',
      planName: 'Restoran',
      maxDevices: 5,
      licenseExpiresAt: ended,
    });
    await renderWithData(<TablesScreen />, data);

    await userEvent.click(await screen.findByRole('button', { name: 'S1, dolu, ₺450,00' }));
    const menu = await screen.findByRole('region', { name: 'Menü' });
    await userEvent.click(await within(menu).findByRole('button', { name: /Ayran/ }));
    expect(
      await screen.findByText('Lisans süresi doldu; yeni sipariş alınamaz.'),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Kalan tutar')).toHaveTextContent('₺450,00'));

    await userEvent.click(screen.getByRole('button', { name: 'Hesap' }));
    const bill = await screen.findByRole('dialog', { name: 'Hesap' });
    await within(bill).findByRole('checkbox', { name: /Adana kebap/ });
    await userEvent.click(within(bill).getByRole('button', { name: 'Ödemeyi al' }));
    await waitFor(async () => expect(await recentSales(data.db)).toMatchObject([{ total: 45000 }]));
  });
});

describe('paying a tab with a course kept back', () => {
  async function tabWithHeldCourse() {
    const data = await restaurant();
    const [table] = await listDiningTables(data.db);
    const waiter = { deviceCode: 'K1' };
    const kebab = await data.db.products.filter((one) => one.name === 'Adana kebap').first();
    const ayran = await data.db.products.filter((one) => one.name === 'Ayran').first();
    const tab = await openTab(data.db, { tableId: table!.id, ...waiter }, new Date());
    await addTabItem(data.db, tab.id, ayran!, { qtyMilli: 1000 }, waiter, new Date());
    await addTabItem(data.db, tab.id, kebab!, { qtyMilli: 1000, hold: true }, waiter, new Date());
    await sendTab(data.db, tab.id, new Date());
    await renderWithData(<TablesScreen />, data);
    await userEvent.click(await screen.findByRole('button', { name: 'S1, dolu, ₺490,00' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Hesap' }));
    const bill = await screen.findByRole('dialog', { name: 'Hesap' });
    return { data, bill };
  }

  it('charges only what was sent, until the waiter sends the rest with the bill', async () => {
    const { data, bill } = await tabWithHeldCourse();
    const unsent = await within(bill).findByRole('region', { name: 'Mutfağa gitmemiş kalemler' });
    expect(unsent).toHaveTextContent('Adana kebap');
    expect(unsent).toHaveTextContent('bekletiliyor');
    expect(within(bill).queryByRole('checkbox', { name: /Adana kebap/ })).toBeNull();
    await waitFor(() =>
      expect(within(bill).getByLabelText('Ödenecek tutar')).toHaveTextContent('₺40,00'),
    );

    await userEvent.click(within(unsent).getByRole('button', { name: 'Gönder ve hesaba kat' }));
    await within(bill).findByRole('checkbox', { name: /Adana kebap/ });
    await waitFor(() =>
      expect(within(bill).getByLabelText('Ödenecek tutar')).toHaveTextContent('₺490,00'),
    );
    expect((await kitchenTickets(data.db, 'kitchen'))[0]?.items).toHaveLength(1);
    await userEvent.click(within(bill).getByRole('button', { name: 'Ödemeyi al' }));

    expect(await screen.findByRole('button', { name: 'S1, boş' })).toBeInTheDocument();
    expect(await recentSales(data.db)).toMatchObject([{ total: 49000 }]);
  });

  it('drops the course kept back, and leaves no ticket of it on the kitchen screen', async () => {
    const { data, bill } = await tabWithHeldCourse();
    const unsent = await within(bill).findByRole('region', { name: 'Mutfağa gitmemiş kalemler' });
    await userEvent.click(within(unsent).getByRole('button', { name: 'Adisyondan çıkar' }));
    await waitFor(() =>
      expect(within(bill).queryByRole('region', { name: 'Mutfağa gitmemiş kalemler' })).toBeNull(),
    );
    await userEvent.click(within(bill).getByRole('button', { name: 'Ödemeyi al' }));

    expect(await screen.findByRole('button', { name: 'S1, boş' })).toBeInTheDocument();
    expect(await recentSales(data.db)).toMatchObject([{ total: 4000 }]);
    expect(await kitchenTickets(data.db, 'kitchen')).toEqual([]);
  });
});

describe('the receipt of a payment', () => {
  async function payKebab(receipt: { printing: boolean; autoPrint: boolean }) {
    localStorage.setItem(
      'rk.receipt',
      JSON.stringify({ ...receipt, paperWidth: 80, shopName: '', header: '', footer: '' }),
    );
    const data = await restaurant();
    await renderWithData(<TablesScreen />, data);
    await userEvent.click(await screen.findByRole('button', { name: 'S1, boş' }));
    const menu = await screen.findByRole('region', { name: 'Menü' });
    await userEvent.click(await within(menu).findByRole('button', { name: /Adana kebap/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Mutfağa gönder (1)' }));
    await userEvent.click(screen.getByRole('button', { name: 'Hesap' }));
    return screen.findByRole('dialog', { name: 'Hesap' });
  }

  it('prints by itself when the receipt is set to print after every sale', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    const bill = await payKebab({ printing: true, autoPrint: true });
    expect(await within(bill).findByRole('checkbox', { name: 'Fiş yazdır' })).toBeChecked();
    await userEvent.click(within(bill).getByRole('button', { name: 'Ödemeyi al' }));

    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    expect(document.getElementById('print-root')).toHaveTextContent('Adana kebap');
    // The table the bill was for, as the floor names it.
    expect(document.getElementById('print-root')).toHaveTextContent('S1');
    window.dispatchEvent(new Event('afterprint'));
    print.mockRestore();
  });

  it('prints when asked, with printing on but not after every sale', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    const bill = await payKebab({ printing: true, autoPrint: false });
    const ask = await within(bill).findByRole('checkbox', { name: 'Fiş yazdır' });
    expect(ask).not.toBeChecked();
    await userEvent.click(ask);
    await userEvent.click(within(bill).getByRole('button', { name: 'Ödemeyi al' }));

    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    window.dispatchEvent(new Event('afterprint'));
    print.mockRestore();
  });

  it('prints the pre-bill (adisyon), which says it is no receipt', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    const bill = await payKebab({ printing: false, autoPrint: false });
    await within(bill).findByRole('checkbox', { name: /Adana kebap/ });
    await userEvent.click(within(bill).getByRole('button', { name: 'Adisyon yazdır' }));

    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    const paper = document.getElementById('print-root');
    expect(paper).toHaveTextContent('ÖN HESAP (ADİSYON)');
    expect(paper).toHaveTextContent('Adana kebap');
    expect(paper).toHaveTextContent('S1');
    expect(paper).toHaveTextContent('Ödeme fişi değildir.');
    window.dispatchEvent(new Event('afterprint'));
    // Nothing was paid: the bill is still open.
    expect(within(bill).getByRole('button', { name: 'Ödemeyi al' })).toBeEnabled();
    print.mockRestore();
  });

  it('offers no receipt while printing is off', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    const bill = await payKebab({ printing: false, autoPrint: false });
    // Once the lines are in, where the choice would be.
    await within(bill).findByRole('checkbox', { name: /Adana kebap/ });
    expect(within(bill).queryByRole('checkbox', { name: 'Fiş yazdır' })).toBeNull();
    await userEvent.click(within(bill).getByRole('button', { name: 'Ödemeyi al' }));
    expect(
      await screen.findByRole('button', { name: 'S1, boş' }, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(print).not.toHaveBeenCalled();
    print.mockRestore();
  });
});

describe('the kitchen’s screen', () => {
  it('shows what to prepare and takes it off once ready', async () => {
    const data = await restaurant();
    await renderWithData(<TablesScreen />, data);
    await userEvent.click(await screen.findByRole('button', { name: 'S1, boş' }));
    const menu = await screen.findByRole('region', { name: 'Menü' });
    await userEvent.click(await within(menu).findByRole('button', { name: /Adana kebap/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Mutfağa gönder (1)' }));
    await waitFor(async () => expect(await kitchenTickets(data.db, 'kitchen')).toHaveLength(1));
    document.body.innerHTML = '';

    await renderWithData(<KitchenScreen />, data);
    const ticket = await screen.findByRole('listitem', { name: 'S1' });
    await userEvent.click(within(ticket).getByRole('button', { name: 'Hazır: Adana kebap' }));
    expect(await screen.findByText('Bekleyen sipariş yok.')).toBeInTheDocument();

    // Bringing back the last one says what it did, and says so when there is none left.
    await userEvent.click(screen.getByRole('button', { name: 'Son hazırı geri al' }));
    expect(await screen.findByText('1 kalem yeniden bekliyor.')).toBeInTheDocument();
    await userEvent.click(
      within(await screen.findByRole('listitem', { name: 'S1' })).getByRole('button', {
        name: 'Hazır: Adana kebap',
      }),
    );
    await screen.findByText('Bekleyen sipariş yok.');
    await userEvent.click(screen.getByRole('button', { name: 'Son hazırı geri al' }));
    await userEvent.click(screen.getByRole('button', { name: 'Son hazırı geri al' }));
    expect(await screen.findByText('Geri alınacak hazır kalem yok.')).toBeInTheDocument();
  });
});

describe('a table name two areas share', () => {
  async function twoOnes() {
    const data = createTestData();
    await createDiningTable(data.db, { name: '1', area: 'Salon' }, new Date());
    await createDiningTable(data.db, { name: '1', area: 'Dışarı' }, new Date());
    await createDiningTable(data.db, { name: '2', area: 'Salon' }, new Date());
    return data;
  }

  it('tells the two apart on the floor, leaving a unique name plain', async () => {
    const data = await twoOnes();
    await renderWithData(<TablesScreen />, data);
    expect(await screen.findByRole('button', { name: /^Dışarı 1, boş/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Salon 1, boş/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^2, boş/ })).toBeInTheDocument();
  });

  it('tells the two apart in the move list', async () => {
    const data = await twoOnes();
    const [first] = await listDiningTables(data.db);
    const tab = await openTab(data.db, { tableId: first!.id, deviceCode: 'K1' }, new Date());
    await renderWithData(<MoveDialog tabId={tab.id} onClose={vi.fn()} onMoved={vi.fn()} />, data);
    expect(await screen.findByRole('button', { name: 'Dışarı 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '2' })).toBeInTheDocument();
  });
});

describe('the tables in settings', () => {
  it('adds a numbered run of tables in one area', async () => {
    const onDone = vi.fn();
    const { data } = await renderWithData(<TablesSection onDone={onDone} />);
    await userEvent.clear(screen.getByLabelText('Bölüm'));
    await userEvent.type(screen.getByLabelText('Bölüm'), 'Bahçe');
    await userEvent.type(screen.getByLabelText('Ön ek'), 'B');
    await userEvent.clear(screen.getByLabelText('Son no'));
    await userEvent.type(screen.getByLabelText('Son no'), '3');
    await userEvent.click(screen.getByRole('button', { name: 'Masaları ekle' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('3 masa eklendi.'));
    expect((await listDiningTables(data.db)).map((table) => table.name)).toEqual([
      'B1',
      'B2',
      'B3',
    ]);
  });

  it('numbers a new area from 1 and continues an old one, leaving every table as it was', async () => {
    const data = createTestData();
    for (let number = 1; number <= 10; number += 1) {
      await createDiningTable(data.db, { name: String(number), area: 'Salon' }, new Date());
    }
    const before = (await listDiningTables(data.db)).map((one) => [one.id, one.name, one.area]);
    const onDone = vi.fn();
    await renderWithData(<TablesSection onDone={onDone} />, data);
    await screen.findByRole('list', { name: 'Masa listesi' });

    await userEvent.clear(screen.getByLabelText('Bölüm'));
    await userEvent.type(screen.getByLabelText('Bölüm'), 'Dışarı');
    await waitFor(() => expect(screen.getByLabelText('İlk no')).toHaveValue('1'));
    expect(screen.getByLabelText('Son no')).toHaveValue('1');
    await userEvent.click(screen.getByRole('button', { name: 'Masaları ekle' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('1 masa eklendi.'));
    await waitFor(() => expect(screen.getByLabelText('İlk no')).toHaveValue('2'));

    const all = await listDiningTables(data.db);
    expect(all.filter((one) => one.area === 'Dışarı').map((one) => one.name)).toEqual(['1']);
    expect(
      all.filter((one) => one.area === 'Salon').map((one) => [one.id, one.name, one.area]),
    ).toEqual(before);
  });

  it('holds the add button back until the tables have loaded', async () => {
    const data = createTestData();
    await createDiningTable(data.db, { name: '1', area: 'Salon' }, new Date());
    await renderWithData(<TablesSection onDone={vi.fn()} />, data);
    // Before the list is in, the run to add is the empty-restaurant 1 to 10.
    expect(screen.getByRole('button', { name: 'Masaları ekle' })).toBeDisabled();
    await screen.findByRole('list', { name: 'Masa listesi' });
    expect(screen.getByRole('button', { name: 'Masaları ekle' })).toBeEnabled();
  });

  it('does not remove a table while its tab has lines to pay', async () => {
    const data = await restaurant();
    const [table] = await listDiningTables(data.db);
    const tab = await openTab(data.db, { tableId: table!.id, deviceCode: 'K1' }, new Date());
    const kebab = await data.db.products.filter((one) => one.name === 'Adana kebap').first();
    await addTabItem(data.db, tab.id, kebab!, { qtyMilli: 1000 }, { deviceCode: 'K1' }, new Date());
    const onDone = vi.fn();
    await renderWithData(<TablesSection onDone={onDone} />, data);

    await userEvent.click(await screen.findByRole('button', { name: 'Kaldır: S1' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Açık adisyonu olan masa kaldırılamaz (S1). Önce hesabı alın ya da masayı taşıyın.',
    );
    expect(onDone).not.toHaveBeenCalled();
    expect((await listDiningTables(data.db)).map((one) => one.name)).toEqual(['S1']);
  });
});
