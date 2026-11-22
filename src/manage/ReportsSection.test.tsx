import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '@/app/App';
import { DEFAULT_DEVICE, saveDeviceSettings } from '@/app/device';
import { createProduct } from '@/data/products';
import { recordSale } from '@/data/sales';
import { createStaff } from '@/data/staff';
import { businessDate } from '@/domain/businessDate';
import { periodOf } from '@/reports/period';
import { createTestData, renderWithData } from '@/test/renderWithData';
import { ReportsSection } from './ReportsSection';

const DAY_MS = 24 * 60 * 60 * 1000;

async function salesData() {
  const data = createTestData();
  const tea = await createProduct(
    data.db,
    { name: 'Çay', sellPrice: 9000, buyPrice: 7000, vatRate: 1 },
    new Date(Date.now() - 3 * DAY_MS),
  );
  const sell = (at: Date, qty: number, deviceCode = 'K1') =>
    recordSale(data.db, {
      deviceCode,
      at,
      lines: [{ productId: tea.id, qtyMilli: qty * 1000 }],
      payments: [{ method: 'cash', amount: qty * 9000 }],
    });
  return { data, sell };
}

function tile(label: string) {
  return screen.getByRole('group', { name: label });
}

async function netSales(amount: string) {
  return within(await screen.findByRole('group', { name: 'Net satış' })).findByText(amount);
}

describe('periodOf', () => {
  it('names today, yesterday, this week and this month as business days', () => {
    // Thursday, 29 October 2026.
    expect(periodOf('today', '2026-10-29')).toEqual({ from: '2026-10-29', to: '2026-10-29' });
    expect(periodOf('yesterday', '2026-10-29')).toEqual({ from: '2026-10-28', to: '2026-10-28' });
    expect(periodOf('week', '2026-10-29')).toEqual({ from: '2026-10-26', to: '2026-10-29' });
    expect(periodOf('month', '2026-10-29')).toEqual({ from: '2026-10-01', to: '2026-10-29' });
    expect(periodOf('yesterday', '2026-03-01')).toEqual({ from: '2026-02-28', to: '2026-02-28' });
  });
});

describe('ReportsSection', () => {
  afterEach(() => {
    window.location.hash = '';
  });

  it('opens from the menu, as Yönetim’s first section', async () => {
    saveDeviceSettings({ ...DEFAULT_DEVICE, paired: true });
    render(<App />);
    const nav = await screen.findByRole('navigation', { name: 'Ana menü' });
    await userEvent.click(within(nav).getByRole('link', { name: 'Yönetim' }));
    expect(await screen.findByRole('heading', { name: 'Yönetim', level: 1 })).toBeInTheDocument();
    const sections = screen.getByRole('navigation', { name: 'Yönetim bölümleri' });
    expect(
      await within(sections).findByRole('link', { name: 'Raporlar', current: 'page' }),
    ).toHaveAttribute('href', '#/manage/reports');
    expect(await screen.findByRole('group', { name: 'Net satış' })).toBeInTheDocument();
  });

  it('opens at the address reports had until v1.0.4', async () => {
    saveDeviceSettings({ ...DEFAULT_DEVICE, paired: true });
    window.location.hash = '#/reports';
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Yönetim', level: 1 })).toBeInTheDocument();
    expect(await screen.findByRole('group', { name: 'Net satış' })).toBeInTheDocument();
  });

  it('shows the sales, the tables, the voids and the daily report of the same days', async () => {
    const { data, sell } = await salesData();
    await sell(new Date(), 2);
    await renderWithData(<ReportsSection />, data);
    expect(await netSales('₺180,00')).toBeInTheDocument();
    const views = screen.getByRole('group', { name: 'Görünüm' });
    expect(
      within(views)
        .getAllByRole('radio')
        .map((radio) => radio.closest('label')?.textContent),
    ).toEqual(['Satışlar', 'Masalar', 'İptal / tekrar', 'Günlük rapor']);
    await userEvent.click(screen.getByRole('radio', { name: 'Masalar' }));
    expect(screen.queryByRole('group', { name: 'Net satış' })).toBeNull();
    // The register applies to the sales alone.
    expect(screen.queryByLabelText('Cihaz')).toBeNull();
    // The period stays as chosen across the views.
    expect(screen.getByRole('radio', { name: 'Bugün' })).toBeChecked();
    await userEvent.click(screen.getByRole('radio', { name: 'Dün' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Satışlar' }));
    expect(screen.getByRole('radio', { name: 'Dün' })).toBeChecked();
    expect(await netSales('₺0,00')).toBeInTheDocument();
  });

  it('shows today’s figures', async () => {
    const { data, sell } = await salesData();
    await sell(new Date(), 2);
    await renderWithData(<ReportsSection />, data);
    expect(await netSales('₺180,00')).toBeInTheDocument();
    expect(within(tile('İşlem')).getByText('1')).toBeInTheDocument();
    expect(within(tile('Nakit')).getByText('₺180,00')).toBeInTheDocument();
    expect(within(tile('Brüt kâr')).getByText('₺40,00')).toBeInTheDocument();
    const best = screen.getByRole('table', { name: 'En çok satanlar' });
    expect(within(best).getByText('Çay')).toBeInTheDocument();
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    await userEvent.click(screen.getByRole('button', { name: 'Yazdır' }));
    expect(print).toHaveBeenCalledTimes(1);
    expect(document.getElementById('print-root')).toHaveTextContent('Satış raporu');
    window.dispatchEvent(new Event('afterprint'));
    print.mockRestore();
  });

  it('speaks of the restaurant’s bills, and leaves out credit and returns it never has', async () => {
    const { data, sell } = await salesData();
    await sell(new Date(), 2);
    await renderWithData(<ReportsSection />, data);
    expect(await netSales('₺180,00')).toBeInTheDocument();
    expect(within(tile('Ortalama hesap')).getByText('₺180,00')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Ortalama sepet' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Veresiye' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'İade' })).toBeNull();
    expect(screen.queryByText(/İade öncesi satış/)).toBeNull();
  });

  it('does not count a dish as pure profit when its buy price was never entered', async () => {
    const data = createTestData();
    const kebab = await createProduct(
      data.db,
      { name: 'Adana kebap', sellPrice: 45000, vatRate: 10 },
      new Date(Date.now() - DAY_MS),
    );
    await recordSale(data.db, {
      deviceCode: 'K1',
      at: new Date(),
      lines: [{ productId: kebab.id, qtyMilli: 1000 }],
      payments: [{ method: 'card', amount: 45000 }],
    });
    await renderWithData(<ReportsSection />, data);
    expect(await netSales('₺450,00')).toBeInTheDocument();
    expect(within(tile('Brüt kâr')).getByText('—')).toBeInTheDocument();
    expect(within(tile('Brüt kâr')).getByText('Alış fiyatı girilmemiş')).toBeInTheDocument();
  });

  it('changes the range and the register', async () => {
    const { data, sell } = await salesData();
    await sell(new Date(), 1, 'K1');
    await sell(new Date(Date.now() - DAY_MS), 3, 'K2');
    await renderWithData(<ReportsSection />, data);
    expect(await netSales('₺90,00')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Dün' }));
    expect(await netSales('₺270,00')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Cihaz'), 'K2');
    expect(await netSales('₺270,00')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Cihaz'), 'K1');
    expect(await netSales('₺0,00')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Cihaz'), 'Tümü');
    await userEvent.click(screen.getByRole('radio', { name: 'Bugün' }));
    expect(await netSales('₺90,00')).toBeInTheDocument();
    // A custom range starts from the days on screen; each step shows a figure the last did not.
    await userEvent.click(screen.getByRole('radio', { name: 'Özel' }));
    const yesterday = businessDate(new Date(Date.now() - DAY_MS));
    fireEvent.change(screen.getByLabelText('Başlangıç'), { target: { value: yesterday } });
    expect(await netSales('₺360,00')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Bitiş'), { target: { value: yesterday } });
    expect(await netSales('₺270,00')).toBeInTheDocument();
  });

  it('shows the staff table on the reports screen', async () => {
    const { data, sell } = await salesData();
    await createStaff(
      data.db,
      { name: 'Kaan', role: 'owner', pin: '4821' },
      new Date(Date.now() - DAY_MS),
    );
    const ayse = await createStaff(
      data.db,
      { name: 'Ayşe', role: 'cashier', pin: '1234' },
      new Date(Date.now() - DAY_MS),
    );
    await sell(new Date(), 1);
    const tea = (await data.db.products.toArray())[0];
    await recordSale(data.db, {
      deviceCode: 'K1',
      at: new Date(),
      staffId: ayse.id,
      lines: [{ productId: tea?.id ?? '', qtyMilli: 2000 }],
      payments: [{ method: 'cash', amount: 18000 }],
    });
    await renderWithData(<ReportsSection />, data);
    const table = await screen.findByRole('table', { name: 'Personel' });
    expect(within(table).getByText('Ayşe')).toBeInTheDocument();
    expect(within(table).getByText('Personelsiz')).toBeInTheDocument();
  });

  it('exports the products sold as CSV', async () => {
    const { data, sell } = await salesData();
    await sell(new Date(), 2);
    const files: Blob[] = [];
    URL.createObjectURL = vi.fn((file: Blob) => {
      files.push(file);
      return 'blob:rapor';
    });
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    try {
      await renderWithData(<ReportsSection />, data);
      await netSales('₺180,00');
      await userEvent.click(screen.getByRole('button', { name: 'CSV indir' }));
      expect((click.mock.contexts[0] as HTMLAnchorElement).download).toMatch(
        /^satislar-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.csv$/,
      );
      const text = (await files[0]?.text()) ?? '';
      expect(text).toContain('Ürün;Miktar;Birim;Tutar');
      expect(text).toContain('Çay;2;Adet;180,00');
    } finally {
      click.mockRestore();
    }
  });
});
