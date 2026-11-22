import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionProvider } from '@/app/SessionProvider';
import type { AppData } from '@/app/appData';
import { createCustomer, customerBalance } from '@/data/customers';
import { createProduct } from '@/data/products';
import { addTabItem, createDiningTable, openTab, sendTab } from '@/data/restaurant';
import { recentSales } from '@/data/sales';
import { createStaff } from '@/data/staff';
import type { Permission } from '@/domain/permissions';
import { createTestData, disposeTestData, renderWithData } from '@/test/renderWithData';
import { signInAs } from '@/test/session';
import { KitchenScreen } from './KitchenScreen';
import { RemakeDialog } from './RemakeDialog';
import { TablesScreen } from './TablesScreen';

afterEach(async () => {
  localStorage.clear();
  await disposeTestData();
});

const before = () => new Date(Date.now() - 60_000);

/** Table S1 with Adana kebap (₺450) and Ayran (₺40) sent to the kitchen and the bar. */
async function servedTable(): Promise<{ data: AppData; tabId: string }> {
  const data = createTestData();
  const at = before();
  const table = await createDiningTable(data.db, { name: 'S1', area: 'Salon' }, at);
  const kebab = await createProduct(
    data.db,
    { name: 'Adana kebap', sellPrice: 45000, vatRate: 10, station: 'kitchen' },
    at,
  );
  const ayran = await createProduct(
    data.db,
    { name: 'Ayran', sellPrice: 4000, vatRate: 1, station: 'bar' },
    at,
  );
  const waiter = { deviceCode: 'K1' };
  const tab = await openTab(data.db, { tableId: table.id, ...waiter }, at);
  await addTabItem(data.db, tab.id, kebab, { qtyMilli: 1000 }, waiter, at);
  await addTabItem(data.db, tab.id, ayran, { qtyMilli: 1000 }, waiter, at);
  await sendTab(data.db, tab.id, at);
  return { data, tabId: tab.id };
}

/** Staff of the restaurant, with one person signed in on this register. */
async function signedIn(
  data: AppData,
  who: 'owner' | 'waiter',
  waiterPermissions?: Partial<Record<Permission, boolean>>,
) {
  const mert = await createStaff(data.db, { name: 'Mert', role: 'owner', pin: '1234' }, before());
  await createStaff(data.db, { name: 'Zeynep', role: 'manager', pin: '4444' }, before());
  const ali = await createStaff(
    data.db,
    {
      name: 'Ali',
      role: 'cashier',
      pin: '2222',
      ...(waiterPermissions ? { permissions: waiterPermissions } : {}),
    },
    before(),
  );
  const person = who === 'owner' ? mert : ali;
  await signInAs(data.db, person.id);
  return person;
}

async function openTable(data: AppData) {
  await renderWithData(
    <SessionProvider>
      <TablesScreen />
    </SessionProvider>,
    data,
  );
  // The first screen of a file opens the database and the session: slow on a busy machine.
  await userEvent.click(
    await screen.findByRole('button', { name: 'S1, dolu, ₺490,00' }, { timeout: 5000 }),
  );
}

async function openBill(data: AppData) {
  await openTable(data);
  await userEvent.click(await screen.findByRole('button', { name: 'Hesap' }));
  const bill = await screen.findByRole('dialog', { name: 'Hesap' });
  await waitFor(() =>
    expect(within(bill).getByLabelText('Ödenecek tutar')).toHaveTextContent('₺490,00'),
  );
  return bill;
}

async function approveAs(name: string, pin: string) {
  const approval = await screen.findByRole('dialog', { name: 'Yetkili onayı' });
  await within(approval).findByRole('option', { name: name });
  await userEvent.selectOptions(within(approval).getByLabelText('Onaylayan'), name);
  await userEvent.type(within(approval).getByLabelText('PIN'), pin);
  await userEvent.click(within(approval).getByRole('button', { name: 'Onayla' }));
}

describe('voiding a line', () => {
  it('keeps who voided it', async () => {
    const { data, tabId } = await servedTable();
    const mert = await signedIn(data, 'owner');
    await openTable(data);
    await userEvent.click(await screen.findByRole('button', { name: 'Ayran: işlemler' }));
    await userEvent.click(
      within(await screen.findByRole('dialog', { name: 'Ayran' })).getByRole('button', {
        name: 'İptal',
      }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'İptal: Ayran' });
    await userEvent.type(within(dialog).getByLabelText('Neden'), 'Vazgeçti');
    await userEvent.click(within(dialog).getByRole('button', { name: 'İptal et' }));

    await waitFor(async () =>
      expect(
        (await data.db.tabItems.where('tabId').equals(tabId).toArray()).find(
          (item) => item.name === 'Ayran',
        ),
      ).toMatchObject({ status: 'void', voidedByStaffId: mert.id }),
    );
  });
});

describe('making a line again (Tekrar hazırla)', () => {
  it('asks why, sends a free copy to the kitchen, and the bill stays as it was', async () => {
    const { data, tabId } = await servedTable();
    await signedIn(data, 'owner');
    await openTable(data);
    await userEvent.click(await screen.findByRole('button', { name: 'Adana kebap: işlemler' }));
    await userEvent.click(
      within(await screen.findByRole('dialog', { name: 'Adana kebap' })).getByRole('button', {
        name: 'Tekrar hazırla',
      }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Tekrar hazırla: Adana kebap' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Tekrar hazırla' }));
    expect(await within(dialog).findByText('Tekrar hazırlamanın nedenini yazın.')).toBeVisible();
    await userEvent.type(within(dialog).getByLabelText('Neden'), 'Soğuk geldi');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Tekrar hazırla' }));

    expect(await screen.findByText('Adana kebap tekrar hazırlanıyor.')).toBeInTheDocument();
    const lines = await data.db.tabItems.where('tabId').equals(tabId).toArray();
    expect(lines.filter((item) => item.remakeOf)).toMatchObject([
      { name: 'Adana kebap', complimentary: true, status: 'sent', remakeReason: 'Soğuk geldi' },
    ]);
    // Still ₺490 to pay: the remake is on the house, and the adisyon says what it is.
    expect(screen.getAllByLabelText('Kalan tutar')[0]).toHaveTextContent('₺490,00');
    expect(await screen.findByText('1 · Hazırlanıyor · Tekrar')).toBeInTheDocument();

    document.body.innerHTML = '';
    await renderWithData(<KitchenScreen />, data);
    const ticket = await screen.findByRole('listitem', { name: 'S1' });
    const marked = within(ticket).getAllByRole('button', { name: 'Hazır: Adana kebap' });
    expect(marked).toHaveLength(2);
    expect(within(marked[1]!).getByText('Tekrar · Soğuk geldi')).toBeInTheDocument();
    expect(within(marked[0]!).queryByText(/Tekrar/)).toBeNull();
  });

  it('sends one copy however fast the reason is sent twice', async () => {
    const { data, tabId } = await servedTable();
    const [line] = await data.db.tabItems.where('tabId').equals(tabId).toArray();
    // The remake never finishes here: the window stays open, as on a slow device.
    const onRemake = vi.fn(() => new Promise<void>(() => {}));
    render(<RemakeDialog item={line!} onClose={() => {}} onRemake={onRemake} />);
    const dialog = await screen.findByRole('dialog', { name: `Tekrar hazırla: ${line!.name}` });
    await userEvent.type(within(dialog).getByLabelText('Neden'), 'Soğuk');
    const form = within(dialog).getByLabelText('Neden').closest('form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(onRemake).toHaveBeenCalledTimes(1);
  });

  it('asks how many of a line of several, one by default', async () => {
    const { data, tabId } = await servedTable();
    const [line] = await data.db.tabItems.where('tabId').equals(tabId).toArray();
    const onRemake = vi.fn(async () => {});
    render(
      <RemakeDialog item={{ ...line!, qtyMilli: 4000 }} onClose={() => {}} onRemake={onRemake} />,
    );
    const dialog = await screen.findByRole('dialog', { name: `Tekrar hazırla: ${line!.name}` });
    expect(within(dialog).getByLabelText('Kaç adet')).toHaveValue('1');
    await userEvent.type(within(dialog).getByLabelText('Neden'), 'Soğuk');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Tekrar hazırla' }));
    expect(onRemake).toHaveBeenCalledWith('Soğuk', 1000);

    await userEvent.clear(within(dialog).getByLabelText('Kaç adet'));
    await userEvent.type(within(dialog).getByLabelText('Kaç adet'), '5');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Tekrar hazırla' }));
    expect(await within(dialog).findByText('1 ile 4 arasında bir sayı girin.')).toBeInTheDocument();
    expect(onRemake).toHaveBeenCalledTimes(1);
  });

  it('remakes the whole weighed line by default', async () => {
    const { data, tabId } = await servedTable();
    const [line] = await data.db.tabItems.where('tabId').equals(tabId).toArray();
    const onRemake = vi.fn(async () => {});
    render(
      <RemakeDialog
        item={{ ...line!, unit: 'kg', qtyMilli: 1500 }}
        onClose={() => {}}
        onRemake={onRemake}
      />,
    );
    const dialog = await screen.findByRole('dialog', { name: `Tekrar hazırla: ${line!.name}` });
    expect(within(dialog).getByLabelText('Kaç kg')).toHaveValue('1,5');
    await userEvent.type(within(dialog).getByLabelText('Neden'), 'Soğuk');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Tekrar hazırla' }));
    expect(onRemake).toHaveBeenCalledWith('Soğuk', 1500);
  });

  it('asks a waiter without the treat permission for a manager’s PIN', async () => {
    const { data, tabId } = await servedTable();
    await signedIn(data, 'waiter');
    await openTable(data);
    await userEvent.click(await screen.findByRole('button', { name: 'Adana kebap: işlemler' }));
    await userEvent.click(
      within(await screen.findByRole('dialog', { name: 'Adana kebap' })).getByRole('button', {
        name: 'Tekrar hazırla',
      }),
    );
    await approveAs('Zeynep · Yönetici', '4444');
    const dialog = await screen.findByRole('dialog', { name: 'Tekrar hazırla: Adana kebap' });
    await userEvent.type(within(dialog).getByLabelText('Neden'), 'Yere düştü');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Tekrar hazırla' }));

    await waitFor(async () =>
      expect(
        (await data.db.tabItems.where('tabId').equals(tabId).toArray()).filter(
          (item) => item.remakeOf,
        ),
      ).toHaveLength(1),
    );
  });
});

describe('paying a tab on credit (Veresiye)', () => {
  it('is not offered to a waiter', async () => {
    const { data } = await servedTable();
    await signedIn(data, 'waiter');
    const bill = await openBill(data);
    expect(within(bill).getByRole('radio', { name: 'Nakit' })).toBeInTheDocument();
    expect(within(bill).queryByRole('radio', { name: 'Veresiye' })).toBeNull();
  });

  it('needs a customer before it is paid, and writes the bill to their account', async () => {
    const { data } = await servedTable();
    await signedIn(data, 'owner');
    const ahmet = await createCustomer(data.db, { name: 'Ahmet Yılmaz' }, before());
    const bill = await openBill(data);
    await userEvent.click(within(bill).getByRole('radio', { name: 'Veresiye' }));
    await userEvent.click(within(bill).getByRole('button', { name: 'Ödemeyi al' }));

    // Without a customer nothing is paid.
    const picker = await screen.findByRole('dialog', { name: 'Veresiye müşterisi' });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(picker).not.toBeInTheDocument());
    expect(await recentSales(data.db)).toEqual([]);

    // The bill takes clicks again once the closed picker has let go of the page.
    await waitFor(() => userEvent.click(within(bill).getByRole('button', { name: 'Ödemeyi al' })));
    const again = await screen.findByRole('dialog', { name: 'Veresiye müşterisi' });
    await userEvent.type(within(again).getByLabelText(/Müşteri ara/), 'Ahmet');
    await userEvent.click(await within(again).findByRole('button', { name: /Ahmet Yılmaz/ }));

    expect(await screen.findByRole('button', { name: 'S1, boş' })).toBeInTheDocument();
    expect(await recentSales(data.db)).toMatchObject([
      { total: 49000, customerId: ahmet.id, payments: [{ method: 'credit', amount: 49000 }] },
    ]);
    expect(await customerBalance(data.db, ahmet.id)).toBe(49000);
  });

  it('is refused over the limit where no staff are set up to approve it', async () => {
    const { data } = await servedTable();
    await createCustomer(data.db, { name: 'Ahmet Yılmaz', creditLimit: 30000 }, before());
    const bill = await openBill(data);
    await userEvent.click(within(bill).getByRole('radio', { name: 'Veresiye' }));
    await userEvent.click(within(bill).getByRole('button', { name: 'Ödemeyi al' }));
    const picker = await screen.findByRole('dialog', { name: 'Veresiye müşterisi' });
    await userEvent.type(within(picker).getByLabelText(/Müşteri ara/), 'Ahmet');
    await userEvent.click(await within(picker).findByRole('button', { name: /Ahmet Yılmaz/ }));

    expect(await within(bill).findByRole('alert')).toHaveTextContent(
      'Müşterinin veresiye limiti aşılıyor.',
    );
    expect(screen.queryByRole('dialog', { name: 'Yetkili onayı' })).toBeNull();
    expect(await recentSales(data.db)).toEqual([]);
  });

  it('prints the customer on the receipt of a credit payment', async () => {
    localStorage.setItem(
      'rk.receipt',
      JSON.stringify({
        printing: true,
        autoPrint: true,
        paperWidth: 80,
        shopName: '',
        header: '',
        footer: '',
      }),
    );
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    const { data } = await servedTable();
    await signedIn(data, 'owner');
    await createCustomer(data.db, { name: 'Ahmet Yılmaz' }, before());
    const bill = await openBill(data);
    await userEvent.click(within(bill).getByRole('radio', { name: 'Veresiye' }));
    await userEvent.click(within(bill).getByRole('button', { name: 'Ödemeyi al' }));
    const picker = await screen.findByRole('dialog', { name: 'Veresiye müşterisi' });
    await userEvent.type(within(picker).getByLabelText(/Müşteri ara/), 'Ahmet');
    await userEvent.click(await within(picker).findByRole('button', { name: /Ahmet Yılmaz/ }));

    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    expect(document.getElementById('print-root')).toHaveTextContent('Müşteri: Ahmet Yılmaz');
    window.dispatchEvent(new Event('afterprint'));
    print.mockRestore();
  });

  it('asks for a PIN over the limit even from a person who may approve it', async () => {
    const { data } = await servedTable();
    await signedIn(data, 'owner');
    const ahmet = await createCustomer(
      data.db,
      { name: 'Ahmet Yılmaz', creditLimit: 30000 },
      before(),
    );
    const bill = await openBill(data);
    await userEvent.click(within(bill).getByRole('radio', { name: 'Veresiye' }));
    await userEvent.click(within(bill).getByRole('button', { name: 'Ödemeyi al' }));
    const picker = await screen.findByRole('dialog', { name: 'Veresiye müşterisi' });
    await userEvent.type(within(picker).getByLabelText(/Müşteri ara/), 'Ahmet');
    await userEvent.click(await within(picker).findByRole('button', { name: /Ahmet Yılmaz/ }));

    expect(await screen.findByRole('dialog', { name: 'Yetkili onayı' })).toBeInTheDocument();
    expect(await customerBalance(data.db, ahmet.id)).toBe(0);
    await approveAs('Zeynep · Yönetici', '4444');
    expect(await screen.findByRole('button', { name: 'S1, boş' })).toBeInTheDocument();
    expect(await customerBalance(data.db, ahmet.id)).toBe(49000);
    // The approval is logged, as on the market's register.
    await waitFor(async () =>
      expect((await data.db.auditLog.toArray()).some((entry) => entry.action === 'approval')).toBe(
        true,
      ),
    );
  });

  it('asks for a permitted person’s PIN to go over the customer’s limit', async () => {
    const { data } = await servedTable();
    await signedIn(data, 'waiter', { creditSale: true });
    const ahmet = await createCustomer(
      data.db,
      { name: 'Ahmet Yılmaz', creditLimit: 30000 },
      before(),
    );
    const bill = await openBill(data);
    await userEvent.click(within(bill).getByRole('radio', { name: 'Veresiye' }));
    await userEvent.click(within(bill).getByRole('button', { name: 'Ödemeyi al' }));
    const picker = await screen.findByRole('dialog', { name: 'Veresiye müşterisi' });
    await userEvent.type(within(picker).getByLabelText(/Müşteri ara/), 'Ahmet');
    await userEvent.click(await within(picker).findByRole('button', { name: /Ahmet Yılmaz/ }));

    await approveAs('Zeynep · Yönetici', '4444');

    expect(await screen.findByRole('button', { name: 'S1, boş' })).toBeInTheDocument();
    expect(await customerBalance(data.db, ahmet.id)).toBe(49000);
  });
});
