import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createProduct } from '@/data/products';
import { recordSale } from '@/data/sales';
import { archiveStaff, createStaff } from '@/data/staff';
import type { TabItemRecord, TabRecord } from '@/data/types';
import { createTestData, renderWithData } from '@/test/renderWithData';
import { StaffSection } from './StaffSection';

const before = () => new Date(Date.now() - 60_000);

function tab(id: string, staffId: string, openedAt: string): TabRecord {
  return {
    id,
    status: 'open',
    deviceCode: 'K1',
    staffId,
    openedAt,
    createdAt: openedAt,
    updatedAt: openedAt,
  };
}

function line(id: string, staffId: string, orderedAt: string): TabItemRecord {
  return {
    id,
    tabId: 'T1',
    productId: 'P1',
    name: 'Ayran',
    unit: 'piece',
    unitPrice: 5000,
    qtyMilli: 1000,
    station: 'bar',
    status: 'sent',
    deviceCode: 'K1',
    staffId,
    orderedAt,
    createdAt: orderedAt,
    updatedAt: orderedAt,
  };
}

describe('StaffSection', () => {
  it('explains itself when no one works here yet', async () => {
    await renderWithData(<StaffSection />);
    expect(await screen.findByText(/Henüz personel yok/)).toBeInTheDocument();
  });

  it('shows each person’s day and month, an old one only while they have work in the period', async () => {
    const data = createTestData();
    await createStaff(data.db, { name: 'Kaan', role: 'owner', pin: '4821' }, before());
    const ayse = await createStaff(
      data.db,
      { name: 'Ayşe', role: 'cashier', pin: '1234' },
      before(),
    );
    const can = await createStaff(data.db, { name: 'Can', role: 'cashier', pin: '2345' }, before());
    const eski = await createStaff(
      data.db,
      { name: 'Eski Usta', role: 'cashier', pin: '3456' },
      before(),
    );
    const bosta = await createStaff(
      data.db,
      { name: 'Boşta', role: 'cashier', pin: '4567' },
      before(),
    );
    await archiveStaff(data.db, eski.id, new Date());
    await archiveStaff(data.db, bosta.id, new Date());
    const now = new Date();
    // Today for Ayşe; for Can only an order from earlier this month (skip if it is the 1st).
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 12).toISOString();
    await data.db.tabs.bulkAdd([tab('T1', ayse.id, now.toISOString())]);
    await data.db.tabItems.bulkAdd([
      line('L1', ayse.id, now.toISOString()),
      line('L2', ayse.id, now.toISOString()),
      line('L3', can.id, monthStart),
      line('L4', eski.id, monthStart),
    ]);
    const tea = await createProduct(
      data.db,
      { name: 'Çay', sellPrice: 9000, vatRate: 1 },
      new Date(Date.now() - 3600_000),
    );
    await recordSale(data.db, {
      deviceCode: 'K1',
      at: now,
      staffId: ayse.id,
      lines: [{ productId: tea.id, qtyMilli: 1000 }],
      payments: [{ method: 'cash', amount: 9000 }],
    });
    await renderWithData(<StaffSection />, data);

    const card = await screen.findByRole('group', { name: 'Ayşe' });
    const today = within(card).getByRole('group', { name: 'Bugün' });
    expect(within(today).getByText('Sipariş').nextSibling).toHaveTextContent('2');
    expect(within(today).getByText('Satış').nextSibling).toHaveTextContent('90,00');
    expect(within(card).getByRole('group', { name: 'Bu ay' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Can' })).toBeInTheDocument();
    // Archived with month work: shown, and said to be gone; archived with none: hidden.
    const old = screen.getByRole('group', { name: /Eski Usta/ });
    expect(within(old).getByText('Pasif')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /Boşta/ })).not.toBeInTheDocument();
  });
});
