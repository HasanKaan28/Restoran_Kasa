import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createCategory } from '@/data/categories';
import { createProduct } from '@/data/products';
import { recordSale } from '@/data/sales';
import { businessDate } from '@/domain/businessDate';
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
  await recordSale(data.db, {
    deviceCode: 'K1',
    at: new Date(),
    lines: [
      { productId: tea.id, qtyMilli: 2000 },
      { productId: tea.id, qtyMilli: 1000, lineDiscount: 9000 },
    ],
    payments: [{ method: 'cash', amount: 18000 }],
  });
  return data;
}

const today = () => businessDate(new Date(), { cutoffMinutes: 0 });

describe('DailyReportView', () => {
  it('shows the report of the day by category, with treats and totals', async () => {
    const data = await dayData();
    await renderWithData(<DailyReportView from={today()} to={today()} />, data);
    const table = await screen.findByRole('table', { name: 'İçecek' });
    expect(within(table).getByText('Çay')).toBeInTheDocument();
    expect(within(table).getByText('İçecek ara toplam')).toBeInTheDocument();
    expect(screen.getByText('Genel toplam')).toBeInTheDocument();
    expect(screen.getByText('İkram (1 kalem, menü fiyatıyla)')).toBeInTheDocument();
    expect(screen.getByText('Fiş sayısı')).toBeInTheDocument();
  });

  it('prints the same report and exports it as CSV', async () => {
    const data = await dayData();
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
