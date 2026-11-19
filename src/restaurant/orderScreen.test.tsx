import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCategory } from '@/data/categories';
import { createProduct } from '@/data/products';
import { addTabItem, createDiningTable, markReady, openTab, sendTab } from '@/data/restaurant';
import { createTestData, renderWithData } from '@/test/renderWithData';
import { TablesScreen } from './TablesScreen';

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A phone: every max-width query matches, so the screens take their phone layout. */
function onPhone() {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('max-width'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

async function restaurant() {
  const data = createTestData();
  const at = new Date();
  const table = await createDiningTable(data.db, { name: 'S1', area: 'Salon' }, at);
  const grill = await createCategory(data.db, 'Izgara', at);
  const drinks = await createCategory(data.db, 'İçecek', at);
  const adana = await createProduct(
    data.db,
    { name: 'Adana kebap', sellPrice: 45000, vatRate: 10, categoryId: grill.id },
    at,
  );
  await createProduct(
    data.db,
    { name: 'Ayran', sellPrice: 4000, vatRate: 1, categoryId: drinks.id },
    at,
  );
  return { data, table, adana };
}

describe('the menu on an open tab', () => {
  it('lists the dishes under their categories, in the owner’s order, with tabs to jump', async () => {
    const { data } = await restaurant();
    await renderWithData(<TablesScreen />, data);
    await userEvent.click(await screen.findByRole('button', { name: 'S1, boş' }));
    const menu = await screen.findByRole('region', { name: 'Menü' });
    const tabs = await within(menu).findByRole('navigation', { name: 'Kategoriler' });
    expect(
      within(tabs)
        .getAllByRole('button')
        .map((tab) => tab.textContent),
    ).toEqual(['Izgara', 'İçecek']);
    const drinks = within(menu).getByRole('region', { name: 'İçecek' });
    expect(within(drinks).getByRole('button', { name: /Ayran/ })).toBeInTheDocument();

    await userEvent.click(within(tabs).getByRole('button', { name: 'İçecek' }));
    expect(within(tabs).getByRole('button', { name: 'İçecek' })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  it('shows how many of a dish are on the order and prices every line', async () => {
    const { data } = await restaurant();
    await renderWithData(<TablesScreen />, data);
    await userEvent.click(await screen.findByRole('button', { name: 'S1, boş' }));
    const menu = await screen.findByRole('region', { name: 'Menü' });
    await userEvent.click(await within(menu).findByRole('button', { name: /Adana kebap/ }));
    await userEvent.click(within(menu).getByRole('button', { name: /Adana kebap/ }));
    const order = screen.getByRole('region', { name: 'Adisyon' });
    expect(await within(order).findByText('2 · Gönderilmedi')).toBeInTheDocument();
    expect(
      within(menu).getByRole('button', { name: /Adana kebap.*siparişte 2/ }),
    ).toBeInTheDocument();
    // The line's own amount, as on the paper adisyon.
    expect(await within(within(order).getByRole('list')).findByText('₺900,00')).toBeInTheDocument();
  });
});

describe('an open tab on a phone', () => {
  it('keeps the total, sending and the bill under the thumb, and opens the order as a sheet', async () => {
    onPhone();
    const { data, table, adana } = await restaurant();
    const tab = await openTab(data.db, { tableId: table.id, deviceCode: 'K1' }, new Date());
    await addTabItem(data.db, tab.id, adana, { qtyMilli: 1000 }, { deviceCode: 'K1' }, new Date());
    await sendTab(data.db, tab.id, new Date());
    await renderWithData(<TablesScreen />, data);
    await userEvent.click(await screen.findByRole('button', { name: /^S1, dolu/ }));

    // The menu fills the screen; the order is not laid out beside it.
    const menu = await screen.findByRole('region', { name: 'Menü' });
    expect(screen.queryByRole('region', { name: 'Adisyon' })).not.toBeInTheDocument();
    await userEvent.click(await within(menu).findByRole('button', { name: /Ayran/ }));
    // The tap is confirmed where the waiter is looking.
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'Bildirim' })).toHaveTextContent('Ayran · 1'),
    );
    expect(screen.getByRole('button', { name: 'Hesap' })).toBeEnabled();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Mutfağa gönder (1)' })).toBeEnabled(),
    );

    await userEvent.click(screen.getByRole('button', { name: /Adisyonu aç/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Adisyon' });
    expect(within(sheet).getByText('Adana kebap')).toBeInTheDocument();
    expect(within(sheet).getByText('1 · Gönderilmedi')).toBeInTheDocument();

    // A sent line opens its own actions instead of repeating three buttons on every line.
    await userEvent.click(within(sheet).getByRole('button', { name: 'Adana kebap: işlemler' }));
    const line = await screen.findByRole('dialog', { name: 'Adana kebap' });
    expect(within(line).getByRole('button', { name: 'İptal' })).toBeInTheDocument();
  });
});

describe('serving what is ready', () => {
  it('clears “hazır” from the floor once the ready lines are taken to the table', async () => {
    const { data, table, adana } = await restaurant();
    const tab = await openTab(data.db, { tableId: table.id, deviceCode: 'K1' }, new Date());
    const line = await addTabItem(
      data.db,
      tab.id,
      adana,
      { qtyMilli: 1000 },
      { deviceCode: 'K1' },
      new Date(),
    );
    await sendTab(data.db, tab.id, new Date());
    await markReady(data.db, [line.id], new Date());
    await renderWithData(<TablesScreen />, data);
    expect(await screen.findByRole('button', { name: /^S1, dolu/ })).toHaveTextContent('1 hazır');

    await userEvent.click(screen.getByRole('button', { name: /^S1, dolu/ }));
    const order = await screen.findByRole('region', { name: 'Adisyon' });
    await userEvent.click(
      await within(order).findByRole('button', { name: 'Hazırları servis et (1)' }),
    );
    expect(await within(order).findByText('1 · Servis edildi')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Masalar' }));
    const card = await screen.findByRole('button', { name: /^S1, dolu/ });
    await waitFor(() => expect(card).not.toHaveTextContent('hazır'));
  });
});
