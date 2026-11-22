import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { aSale, aSaleVoid, aStaffer, aTab, aTable, anItem } from '@/test/reportRecords';
import { createTestData, disposeTestData, renderWithData } from '@/test/renderWithData';
import { TableReportView } from './TableReportView';
import { VoidReportView } from './VoidReportView';

afterEach(disposeTestData);

describe('TableReportView', () => {
  it('shows each table with its revenue and a total, archived tables by name', async () => {
    const data = createTestData();
    await data.db.diningTables.add(
      aTable({ id: 't5', name: 'Masa 5', archivedAt: '2026-10-09T00:00:00.000Z' }),
    );
    await data.db.tabs.add(aTab({ id: 'a', tableId: 't5' }));
    await data.db.sales.add(aSale({ id: 's1', total: 12550 }));
    await data.db.tabItems.add(anItem({ id: 'i1', tabId: 'a', paidSaleId: 's1' }));

    await renderWithData(<TableReportView from="2026-10-10" to="2026-10-10" />, data);

    const table = await screen.findByRole('table', { name: 'Masa analizi' });
    const row = await within(table).findByRole('row', { name: /Masa 5/ });
    expect(row.textContent).toContain('125,50');
    expect(within(table).getByRole('row', { name: /Toplam/ })).toBeTruthy();
  });

  it('says so when there is nothing in the period', async () => {
    await renderWithData(<TableReportView from="2026-10-10" to="2026-10-10" />);
    expect(await screen.findByText('Bu dönemde masa satışı yok.')).toBeTruthy();
  });
});

describe('VoidReportView', () => {
  it('shows voids, cancelled tabs and remakes with staff names, old rows as Bilinmiyor', async () => {
    const data = createTestData();
    await data.db.staff.add(aStaffer({ id: 'u1', name: 'Ayşe' }));
    await data.db.sales.add(aSale({ id: 's1', total: 4000 }));
    await data.db.saleVoids.add(
      aSaleVoid({ id: 'v1', saleId: 's1', staffId: 'u1', reason: 'Yanlış fiş' }),
    );
    await data.db.tabs.add(aTab({ id: 'a', status: 'open' }));
    await data.db.tabItems.add(
      anItem({
        id: 'k1',
        tabId: 'a',
        name: 'Lahmacun',
        status: 'void',
        sentAt: '2026-10-10T09:00:00.000Z',
        updatedAt: '2026-10-10T09:30:00.000Z',
      }),
    );

    await renderWithData(<VoidReportView from="2026-10-10" to="2026-10-10" />, data);

    const receipts = await screen.findByRole('table', { name: 'Fiş iptalleri' });
    expect(await within(receipts).findByText('Yanlış fiş')).toBeTruthy();
    expect(within(receipts).getByText('Ayşe')).toBeTruthy();
    const lines = screen.getByRole('table', { name: 'Mutfağa gitmiş satır iptalleri' });
    expect(await within(lines).findByText('Lahmacun')).toBeTruthy();
    expect(within(lines).getByText('Bilinmiyor')).toBeTruthy();
    expect(
      screen.getByText(/1 fiş iptali · 1 satır iptali · 0 iptal adisyon · 0 tekrar/),
    ).toBeTruthy();
  });
});
