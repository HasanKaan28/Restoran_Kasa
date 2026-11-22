import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { createProduct } from '@/data/products';
import { addTabItem, createDiningTable, openTab } from '@/data/restaurant';
import { ReportsSection } from '@/manage/ReportsSection';
import { createTestData, renderWithData } from '@/test/renderWithData';

describe('the restaurant’s day close', () => {
  it('is reached from Yönetim’s reports, names the tabs still open, then counts the till', async () => {
    const data = createTestData();
    const table = await createDiningTable(data.db, { name: '4', area: 'Salon' }, new Date());
    const ezme = await createProduct(
      data.db,
      { name: 'Ezme', sellPrice: 11000, vatRate: 10 },
      new Date(),
    );
    const tab = await openTab(data.db, { tableId: table.id, deviceCode: 'K1' }, new Date());
    await addTabItem(data.db, tab.id, ezme, { qtyMilli: 1000 }, { deviceCode: 'K1' }, new Date());
    await renderWithData(<ReportsSection />, data);

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
    expect(await within(till).findByLabelText('Sayılan nakit')).toBeInTheDocument();
  });

  it('counts the till at once, even when it was never opened that day', async () => {
    const data = createTestData();
    await renderWithData(<ReportsSection />, data);

    await userEvent.click(await screen.findByRole('button', { name: 'Gün sonu' }));
    const close = await screen.findByRole('dialog', { name: 'Gün sonu' });
    // The button is there, disabled, until the open tabs are read: wait for them, then click.
    expect(await within(close).findByText(/Açık adisyon yok\./)).toBeInTheDocument();
    await userEvent.click(within(close).getByRole('button', { name: 'Kasayı say ve günü kapat' }));
    const till = await screen.findByRole('dialog', { name: 'Kasa' });
    // Straight to counting: no "Kasayı aç" at the end of the day, only a word on why it is 0.
    expect(await within(till).findByText(/Kasa açılmadı\./)).toBeInTheDocument();
    expect(within(till).queryByRole('button', { name: 'Kasayı aç' })).toBeNull();
    await userEvent.type(within(till).getByLabelText('Sayılan nakit'), '0');
    await userEvent.click(within(till).getByRole('button', { name: 'Z raporunu kaydet' }));
    expect(await within(till).findByText('Z raporu kaydedildi.')).toBeInTheDocument();
    expect(await data.db.cashSessions.count()).toBe(1);
  });

  it('closes the window when the count is called off, not back to opening the till', async () => {
    const data = createTestData();
    await renderWithData(<ReportsSection />, data);
    await userEvent.click(await screen.findByRole('button', { name: 'Gün sonu' }));
    const close = await screen.findByRole('dialog', { name: 'Gün sonu' });
    // The button is there, disabled, until the open tabs are read: wait for them, then click.
    expect(await within(close).findByText(/Açık adisyon yok\./)).toBeInTheDocument();
    await userEvent.click(within(close).getByRole('button', { name: 'Kasayı say ve günü kapat' }));
    const till = await screen.findByRole('dialog', { name: 'Kasa' });
    await userEvent.click(await within(till).findByRole('button', { name: 'Vazgeç' }));
    expect(screen.queryByRole('dialog', { name: 'Kasa' })).toBeNull();
  });
});
