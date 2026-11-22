import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createCategory } from '@/data/categories';
import { createProduct } from '@/data/products';
import { recordReturn } from '@/data/returns';
import { addTabItem, openTab, payTabItems, remakeItem, sendTab } from '@/data/restaurant';
import { recordSale } from '@/data/sales';
import { createTestData, renderWithData } from '@/test/renderWithData';
import { DailyReportView } from './DailyReportView';

async function dayData() {
  const data = createTestData();
  const drinks = await createCategory(data.db, 'İçecek', new Date());
  const tea = await createProduct(
    data.db,
    { name: 'Çay', sellPrice: 9000, buyPrice: 7000, vatRate: 1, categoryId: drinks.id },
    new Date(),
  );
  const sale = await recordSale(data.db, {
    deviceCode: 'K1',
    at: new Date(),
    lines: [
      { productId: tea.id, qtyMilli: 2000 },
      { productId: tea.id, qtyMilli: 1000, lineDiscount: 9000 },
    ],
    payments: [{ method: 'cash', amount: 18000 }],
  });
  // The day the sale landed on, whatever the clock says.
  return { data, sale, tea };
}

describe('DailyReportView', () => {
  it('says treats and full discounts, and what is already off the total', async () => {
    const { data, sale, tea } = await dayData();
    await recordReturn(data.db, {
      saleId: sale.id,
      lines: [{ productId: tea.id, qtyMilli: 1000 }],
      deviceCode: 'K1',
      at: new Date(),
    });
    await renderWithData(<DailyReportView from={sale.businessDate} to={sale.businessDate} />, data);
    expect(await screen.findByText('İade (1 iade, genel toplamdan düşüldü)')).toBeInTheDocument();
    expect(screen.getByText('İptal (0 fiş, genel toplama dahil değil)')).toBeInTheDocument();
    expect(screen.getByText(/%100\) satırlar da ikram sayılır/)).toBeInTheDocument();
  });

  it('shows the report of the day by category, with treats and totals', async () => {
    const { data, sale } = await dayData();
    const today = () => sale.businessDate;
    await renderWithData(<DailyReportView from={today()} to={today()} />, data);
    const table = await screen.findByRole('table', { name: 'İçecek' });
    expect(within(table).getByText('Çay')).toBeInTheDocument();
    expect(within(table).getByText('İçecek ara toplam')).toBeInTheDocument();
    expect(screen.getByText('Genel toplam')).toBeInTheDocument();
    expect(screen.getByText('İkram (1 kalem, menü fiyatıyla)')).toBeInTheDocument();
    expect(screen.getByText('Fiş sayısı')).toBeInTheDocument();
  });

  it('lists a remade line as Tekrar beside, not inside, the treats', async () => {
    const { data, sale, tea } = await dayData();
    const waiter = { deviceCode: 'K1' };
    const tab = await openTab(data.db, { ...waiter, label: 'Paket' }, new Date());
    const line = await addTabItem(data.db, tab.id, tea, { qtyMilli: 1000 }, waiter, new Date());
    await sendTab(data.db, tab.id, new Date());
    const again = await remakeItem(
      data.db,
      { itemId: line.id, reason: 'Soğuk', ...waiter },
      new Date(),
    );
    await payTabItems(
      data.db,
      {
        tabId: tab.id,
        itemIds: [line.id, again.id],
        payments: [{ method: 'cash', amount: 9000 }],
        ...waiter,
      },
      new Date(),
    );
    await renderWithData(<DailyReportView from={sale.businessDate} to={sale.businessDate} />, data);
    expect(await screen.findByText('Tekrar (1 kalem, menü fiyatıyla)')).toBeInTheDocument();
    expect(screen.getByText('İkram (1 kalem, menü fiyatıyla)')).toBeInTheDocument();
  });

  it('prints the same report and exports it as CSV', async () => {
    const { data, sale } = await dayData();
    const today = () => sale.businessDate;
    const files: Blob[] = [];
    URL.createObjectURL = vi.fn((file: Blob) => {
      files.push(file);
      return 'blob:gunluk';
    });
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    try {
      await renderWithData(<DailyReportView from={today()} to={today()} />, data);
      await screen.findByRole('table', { name: 'İçecek' });
      await userEvent.click(screen.getByRole('button', { name: 'Günlük rapor al' }));
      expect(print).toHaveBeenCalledTimes(1);
      expect(document.getElementById('print-root')).toHaveTextContent('Genel toplam');
      window.dispatchEvent(new Event('afterprint'));
      await userEvent.click(screen.getByRole('button', { name: 'CSV indir' }));
      expect((click.mock.contexts[0] as HTMLAnchorElement).download).toMatch(
        /^gunluk-rapor-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.csv$/,
      );
      expect((await files[0]?.text()) ?? '').toContain('İçecek;Çay;2;Adet;180,00');
    } finally {
      click.mockRestore();
      print.mockRestore();
    }
  });
});
