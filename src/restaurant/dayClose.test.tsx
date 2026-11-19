import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { createProduct } from '@/data/products';
import { addTabItem, createDiningTable, openTab } from '@/data/restaurant';
import { ReportsScreen } from '@/reports/ReportsScreen';
import { createTestData, renderWithData } from '@/test/renderWithData';

describe('the restaurant’s day close', () => {
  it('is reached from Raporlar, names the tabs still open, then counts the till', async () => {
    const data = createTestData();
    const table = await createDiningTable(data.db, { name: '4', area: 'Salon' }, new Date());
    const ezme = await createProduct(
      data.db,
      { name: 'Ezme', sellPrice: 11000, vatRate: 10 },
      new Date(),
    );
    const tab = await openTab(data.db, { tableId: table.id, deviceCode: 'K1' }, new Date());
    await addTabItem(data.db, tab.id, ezme, { qtyMilli: 1000 }, { deviceCode: 'K1' }, new Date());
    await renderWithData(<ReportsScreen />, data);

    await userEvent.click(await screen.findByRole('button', { name: 'Gün sonu' }));
    const close = await screen.findByRole('dialog', { name: 'Gün sonu' });
    const open = await within(close).findByRole('list', { name: 'Açık adisyonlar' });
    expect(open).toHaveTextContent('Masa 4');
    expect(open).toHaveTextContent('₺110,00');
    expect(within(close).getByRole('link', { name: 'Masalara dön' })).toHaveAttribute(
      'href',
      '#/tables',
    );

    await userEvent.click(within(close).getByRole('button', { name: 'Yine de kasayı say' }));
    const till = await screen.findByRole('dialog', { name: 'Kasa' });
    expect(await within(till).findByRole('button', { name: 'Gün sonu (Z)' })).toBeInTheDocument();
  });
});
