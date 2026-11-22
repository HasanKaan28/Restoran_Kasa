import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deliverTab } from '@/data/deliver';
import { createProduct } from '@/data/products';
import { createDiningTable, kitchenTickets } from '@/data/restaurant';
import { createTestData, renderWithData } from '@/test/renderWithData';
import { TablesScreen } from './TablesScreen';

vi.mock('@/data/deliver', async (original) => {
  const actual = await original<typeof import('@/data/deliver')>();
  return { ...actual, deliverTab: vi.fn(actual.deliverTab) };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function bar() {
  const data = createTestData();
  const at = new Date();
  await createDiningTable(data.db, { name: 'S1', area: 'Salon' }, at);
  await createProduct(
    data.db,
    { name: 'Adana kebap', sellPrice: 45000, vatRate: 10, station: 'kitchen' },
    at,
  );
  await createProduct(data.db, { name: 'Efes', sellPrice: 15000, vatRate: 20, station: 'bar' }, at);
  return data;
}

describe('Teslim edildi', () => {
  it('hands the lines being taken over at once: no ticket for the bar, nothing left to serve', async () => {
    const data = await bar();
    await renderWithData(<TablesScreen />, data);
    await userEvent.click(await screen.findByRole('button', { name: 'S1, boş' }));
    const menu = await screen.findByRole('region', { name: 'Menü' });
    await userEvent.click(await within(menu).findByRole('button', { name: /Efes/ }));
    await userEvent.click(within(menu).getByRole('button', { name: /Efes/ }));
    const order = screen.getByRole('region', { name: 'Adisyon' });
    await within(order).findByText('2 · Gönderilmedi');

    await userEvent.click(within(order).getByRole('button', { name: 'Teslim edildi (1)' }));

    expect(await within(order).findByText('2 · Servis edildi')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Bildirim' })).toHaveTextContent(
      '1 kalem teslim edildi.',
    );
    expect(within(order).getByRole('button', { name: 'Mutfağa gönder (0)' })).toBeDisabled();
    expect(within(order).getByRole('button', { name: 'Teslim edildi (0)' })).toBeDisabled();
    expect(within(order).queryByRole('button', { name: /Hazırları servis et/ })).toBeNull();
    expect(await kitchenTickets(data.db, 'bar')).toEqual([]);

    // Handed over is handed over: it cannot be put back to waiting (and so to recall).
    await userEvent.click(within(order).getByRole('button', { name: 'Efes: işlemler' }));
    const line = await screen.findByRole('dialog', { name: 'Efes' });
    expect(within(line).queryByRole('button', { name: 'Servis edilmedi' })).toBeNull();
    expect(within(line).getByRole('button', { name: 'İptal' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');

    await userEvent.click(screen.getByRole('button', { name: 'Masalar' }));
    const card = await screen.findByRole('button', { name: /^S1, dolu/ });
    await waitFor(() => expect(card).toHaveTextContent('₺300,00'));
    expect(card).not.toHaveTextContent('hazır');
  });

  it('asks first when a kitchen line would be handed over too, and hands nothing over on "Vazgeç"', async () => {
    const data = await bar();
    await renderWithData(<TablesScreen />, data);
    await userEvent.click(await screen.findByRole('button', { name: 'S1, boş' }));
    const menu = await screen.findByRole('region', { name: 'Menü' });
    await userEvent.click(await within(menu).findByRole('button', { name: /Efes/ }));
    await userEvent.click(within(menu).getByRole('button', { name: /Adana kebap/ }));
    const order = screen.getByRole('region', { name: 'Adisyon' });

    await userEvent.click(await within(order).findByRole('button', { name: 'Teslim edildi (2)' }));
    const ask = await screen.findByRole('dialog', {
      name: 'Mutfak ürünleri de teslim edilsin mi?',
    });
    expect(ask).toHaveTextContent(
      'Mutfak ürünleri de teslim edilmiş sayılacak, mutfağa gitmeyecek. Devam?',
    );
    await userEvent.click(within(ask).getByRole('button', { name: 'Vazgeç' }));
    expect(await data.db.tabItems.filter((item) => !!item.deliveredAt).count()).toBe(0);

    await userEvent.click(within(order).getByRole('button', { name: 'Teslim edildi (2)' }));
    await userEvent.click(
      within(
        await screen.findByRole('dialog', { name: 'Mutfak ürünleri de teslim edilsin mi?' }),
      ).getByRole('button', { name: 'Devam' }),
    );
    await waitFor(async () =>
      expect(await data.db.tabItems.filter((item) => !!item.deliveredAt).count()).toBe(2),
    );
  });

  it('tells the waiter when the hand-over fails', async () => {
    const data = await bar();
    await renderWithData(<TablesScreen />, data);
    await userEvent.click(await screen.findByRole('button', { name: 'S1, boş' }));
    const menu = await screen.findByRole('region', { name: 'Menü' });
    await userEvent.click(await within(menu).findByRole('button', { name: /Efes/ }));
    const order = screen.getByRole('region', { name: 'Adisyon' });
    vi.mocked(deliverTab).mockRejectedValueOnce(new Error('closed'));

    await userEvent.click(await within(order).findByRole('button', { name: 'Teslim edildi (1)' }));

    expect(await screen.findByText('Teslim edilemedi.')).toBeInTheDocument();
  });

  it('is beside sending on a phone, in the order sheet', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('max-width'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    const data = await bar();
    await renderWithData(<TablesScreen />, data);
    await userEvent.click(await screen.findByRole('button', { name: 'S1, boş' }));
    const menu = await screen.findByRole('region', { name: 'Menü' });
    await userEvent.click(await within(menu).findByRole('button', { name: /Efes/ }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Mutfağa gönder (1)' })).toBeEnabled(),
    );

    await userEvent.click(screen.getByRole('button', { name: /Adisyonu aç/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Adisyon' });
    await userEvent.click(within(sheet).getByRole('button', { name: 'Teslim edildi (1)' }));
    expect(await within(sheet).findByText('1 · Servis edildi')).toBeInTheDocument();
  });
});
