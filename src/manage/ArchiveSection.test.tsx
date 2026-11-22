import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppData } from '@/app/appData';
import { DataProvider } from '@/app/DataProvider';
import { SessionContext, type Session } from '@/app/session';
import { closeCashSession } from '@/data/cash';
import { createProduct } from '@/data/products';
import { recordSale } from '@/data/sales';
import { saveReport } from '@/data/savedReports';
import { loadSummary } from '@/reports/summary';
import { createTestData, disposeTestData, renderWithData } from '@/test/renderWithData';
import { render } from '@testing-library/react';
import { ArchiveSection } from './ArchiveSection';

afterEach(async () => {
  await disposeTestData();
  vi.restoreAllMocks();
});

async function dataWithSale(): Promise<AppData> {
  const data = createTestData();
  const tea = await createProduct(
    data.db,
    { name: 'Çay', sellPrice: 9000, buyPrice: 7000, vatRate: 1 },
    new Date(),
  );
  await recordSale(data.db, {
    deviceCode: data.settings.deviceCode,
    at: new Date(),
    lines: [{ productId: tea.id, qtyMilli: 2000 }],
    payments: [{ method: 'cash', amount: 18000 }],
  });
  return data;
}

function renderAs(ui: ReactElement, data: AppData, can: Session['can']) {
  const session: Session = { staff: null, open: false, can, signIn: () => {}, signOut: () => {} };
  return render(
    <DataProvider value={data}>
      <SessionContext.Provider value={session}>{ui}</SessionContext.Provider>
    </DataProvider>,
  );
}

describe('ArchiveSection', () => {
  it('lists the day-end records and opens the Z report', async () => {
    const data = await dataWithSale();
    await closeCashSession(
      data.db,
      { deviceCode: data.settings.deviceCode, countedCash: 17500 },
      new Date(),
    );
    await renderWithData(<ArchiveSection />, data);
    const records = screen.getByRole('region', { name: 'Gün sonu kayıtları' });
    const row = (await within(records).findByText('₺175,00')).closest('li') as HTMLElement;
    expect(within(row).getByText('₺180,00')).toBeInTheDocument();
    expect(within(row).getByText('−₺5,00')).toBeInTheDocument();
    await userEvent.click(within(row).getByRole('button', { name: /Z raporunu aç/ }));
    const article = await screen.findByRole('article', { name: 'Z raporu' });
    expect(within(article).getByText('Z RAPORU')).toBeInTheDocument();
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    await userEvent.click(screen.getByRole('button', { name: 'Yazdır' }));
    expect(print).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('afterprint'));
  });

  it('says so when there is nothing yet', async () => {
    await renderWithData(<ArchiveSection />);
    expect(await screen.findByText('Henüz gün sonu kaydı yok.')).toBeInTheDocument();
    expect(await screen.findByText('Henüz kaydedilmiş rapor yok.')).toBeInTheDocument();
  });

  it('saves the period under a title and keeps it as it was when later sales come', async () => {
    const data = await dataWithSale();
    await renderWithData(<ArchiveSection />, data);
    const form = screen.getByRole('region', { name: 'Dönemi kaydet' });
    await userEvent.type(within(form).getByLabelText('Başlık'), 'Bugünkü satış');
    await userEvent.click(within(form).getByRole('button', { name: 'Kaydet' }));
    const saved = screen.getByRole('region', { name: 'Kaydedilen raporlar' });
    expect(await within(saved).findByText('Bugünkü satış')).toBeInTheDocument();
    const [record] = await data.db.savedReports.toArray();
    expect(record?.summary.net).toBe(18000);
    expect(
      await data.db.outbox
        .filter((op) => op.kind === 'insert' && op.table === 'savedReports')
        .count(),
    ).toBe(1);
    // More sales after saving: the stored figures stay.
    const [tea] = await data.db.products.toArray();
    await recordSale(data.db, {
      deviceCode: data.settings.deviceCode,
      at: new Date(),
      lines: [{ productId: tea!.id, qtyMilli: 1000 }],
      payments: [{ method: 'cash', amount: 9000 }],
    });
    await userEvent.click(within(saved).getByRole('button', { name: 'Aç, Bugünkü satış' }));
    const dialog = await screen.findByRole('dialog', { name: 'Bugünkü satış' });
    expect(
      within(await within(dialog).findByRole('group', { name: 'Net satış' })).getByText('₺180,00'),
    ).toBeInTheDocument();
  });

  it('exports, prints and archives a saved report', async () => {
    const data = await dataWithSale();
    const summary = await loadSummary(data.db, { from: '0000-01-01', to: '9999-12-31' });
    await saveReport(
      data.db,
      { title: 'Kasım', from: '2026-11-01', to: '2026-11-22', summary, deviceCode: 'K1' },
      new Date(),
    );
    await renderWithData(<ArchiveSection />, data);
    await userEvent.click(await screen.findByRole('button', { name: 'Aç, Kasım' }));
    const dialog = await screen.findByRole('dialog', { name: 'Kasım' });
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    await userEvent.click(within(dialog).getByRole('button', { name: 'Yazdır' }));
    expect(print).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('afterprint'));
    expect(within(dialog).getByRole('button', { name: 'CSV indir' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'Arşivle, Kasım' }));
    await waitFor(() => expect(screen.queryByText('Kasım')).toBeNull());
    expect(screen.getByText('Henüz kaydedilmiş rapor yok.')).toBeInTheDocument();
    expect((await data.db.savedReports.toArray())[0]?.archivedAt).toBeDefined();
  });

  it('says so when archiving a saved report fails, and keeps it listed', async () => {
    const data = await dataWithSale();
    const summary = await loadSummary(data.db, { from: '0000-01-01', to: '9999-12-31' });
    await saveReport(
      data.db,
      { title: 'Kasım', from: '2026-11-01', to: '2026-11-22', summary, deviceCode: 'K1' },
      new Date(),
    );
    await renderWithData(<ArchiveSection />, data);
    const archive = await screen.findByRole('button', { name: 'Arşivle, Kasım' });
    vi.spyOn(data.db.savedReports, 'get').mockRejectedValue(new Error('disk'));
    await userEvent.click(archive);
    expect(await screen.findByText('Rapor arşivlenemedi')).toBeInTheDocument();
    expect(screen.getByText('Kasım')).toBeInTheDocument();
  });

  it('leaves the CSV to the admin and the cost to those who may see it', async () => {
    const data = await dataWithSale();
    const summary = await loadSummary(data.db, { from: '0000-01-01', to: '9999-12-31' });
    await saveReport(
      data.db,
      { title: 'Kasım', from: '2026-11-01', to: '2026-11-22', summary, deviceCode: 'K1' },
      new Date(),
    );
    renderAs(<ArchiveSection />, data, (permission) => permission === 'reports');
    await userEvent.click(await screen.findByRole('button', { name: 'Aç, Kasım' }));
    const dialog = await screen.findByRole('dialog', { name: 'Kasım' });
    expect(await within(dialog).findByRole('group', { name: 'Net satış' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'CSV indir' })).toBeNull();
    expect(within(dialog).queryByRole('group', { name: 'Brüt kâr' })).toBeNull();
  });

  it('shows a saved report of an older shape, without optional fields', async () => {
    const data = createTestData();
    const summary = await loadSummary(data.db, { from: '0000-01-01', to: '9999-12-31' });
    await data.db.savedReports.add({
      id: 'old',
      title: 'Eski rapor',
      kind: 'period',
      from: '2026-10-01',
      to: '2026-10-02',
      summary,
      deviceCode: 'K1',
      createdAt: '2026-10-03T00:00:00.000Z',
      updatedAt: '2026-10-03T00:00:00.000Z',
    });
    await renderWithData(<ArchiveSection />, data);
    expect(await screen.findByText('Eski rapor')).toBeInTheDocument();
  });

  it('opens a pulled report whose summary lacks lists, without crashing', async () => {
    const data = await dataWithSale();
    const full = await loadSummary(data.db, { from: '0000-01-01', to: '9999-12-31' });
    const partial: Partial<typeof full> = { ...full };
    delete partial.byStaff;
    delete partial.categories;
    await data.db.savedReports.add({
      id: 'partial',
      title: 'Eksik rapor',
      kind: 'period',
      from: '2026-10-01',
      to: '2026-10-02',
      summary: partial as never,
      deviceCode: 'K1',
      createdAt: '2026-10-03T00:00:00.000Z',
      updatedAt: '2026-10-03T00:00:00.000Z',
    });
    await renderWithData(<ArchiveSection />, data);
    await userEvent.click(await screen.findByRole('button', { name: 'Aç, Eksik rapor' }));
    const dialog = await screen.findByRole('dialog', { name: 'Eksik rapor' });
    expect(await within(dialog).findByRole('group', { name: 'Net satış' })).toBeInTheDocument();
  });

  it('shows a row with a malformed date safely and keeps the rest of the list', async () => {
    const data = createTestData();
    const summary = await loadSummary(data.db, { from: '0000-01-01', to: '9999-12-31' });
    const base = { kind: 'period', summary, deviceCode: 'K1', updatedAt: 'x' } as const;
    await data.db.savedReports.bulkAdd([
      {
        ...base,
        id: 'good',
        title: 'Sağlam',
        from: '2026-10-01',
        to: '2026-10-02',
        createdAt: '2026-10-03T00:00:00.000Z',
      },
      {
        ...base,
        id: 'badDate',
        title: 'Bozuk tarih',
        from: '2026-10-01',
        to: '2026-10-02',
        createdAt: 'yok',
      },
      {
        ...base,
        id: 'badDays',
        title: 'Bozuk gün',
        from: 5,
        to: undefined,
        createdAt: '2026-10-04T00:00:00.000Z',
      },
      { ...base, id: 'noStamp', title: 'Damgasız', from: '2026-10-01', to: '2026-10-02' },
    ] as never);
    await renderWithData(<ArchiveSection />, data);
    expect(await screen.findByText('Sağlam')).toBeInTheDocument();
    expect(screen.getByText('Bozuk tarih')).toBeInTheDocument();
    expect(screen.getByText('Bozuk gün')).toBeInTheDocument();
    expect(screen.getByText('Damgasız')).toBeInTheDocument();
  });

  it('says so when saving fails', async () => {
    const data = await dataWithSale();
    vi.spyOn(data.db.savedReports, 'add').mockRejectedValue(new Error('disk'));
    await renderWithData(<ArchiveSection />, data);
    const form = screen.getByRole('region', { name: 'Dönemi kaydet' });
    await userEvent.click(within(form).getByRole('button', { name: 'Kaydet' }));
    expect(await screen.findByText('Rapor kaydedilemedi')).toBeInTheDocument();
  });
});
