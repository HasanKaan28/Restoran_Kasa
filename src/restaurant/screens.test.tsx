import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProduct } from '@/data/products';
import { createDiningTable, kitchenTickets, listDiningTables } from '@/data/restaurant';
import { recentSales } from '@/data/sales';
import { createTestData, disposeTestData, renderWithData } from '@/test/renderWithData';
import { KitchenScreen } from './KitchenScreen';
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

    await userEvent.click(screen.getByRole('button', { name: 'Mutfağa gönder (2)' }));
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
});
