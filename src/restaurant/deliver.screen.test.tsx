import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProduct } from '@/data/products';
import { createDiningTable, kitchenTickets } from '@/data/restaurant';
import { createTestData, renderWithData } from '@/test/renderWithData';
import { TablesScreen } from './TablesScreen';

afterEach(() => {
  vi.unstubAllGlobals();
});

async function bar() {
  const data = createTestData();
  const at = new Date();
  await createDiningTable(data.db, { name: 'S1', area: 'Salon' }, at);
  await createProduct(
    data.db,
    { name: 'Efes', sellPrice: 15000, vatRate: 20, station: 'bar' },
    at,
  );
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

    await userEvent.click(screen.getByRole('button', { name: 'Masalar' }));
    const card = await screen.findByRole('button', { name: /^S1, dolu/ });
    await waitFor(() => expect(card).toHaveTextContent('₺300,00'));
    expect(card).not.toHaveTextContent('hazır');
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
