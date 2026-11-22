import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { SessionProvider } from '@/app/SessionProvider';
import { createProduct } from '@/data/products';
import { recordPurchase } from '@/data/purchases';
import { createStaff } from '@/data/staff';
import { createSupplier } from '@/data/suppliers';
import type { Permission } from '@/domain/permissions';
import { createTestData, renderWithData } from '@/test/renderWithData';
import { signInAs } from '@/test/session';
import { SuppliersSection } from './SuppliersSection';

const at = new Date('2026-10-20T09:00:00Z');
const before = () => new Date(Date.now() - 60_000);

/** A supplier with one invoice on account, and a waiter holding exactly `grant`, signed in. */
async function invoiced(grant: Partial<Record<Permission, boolean>>) {
  const data = createTestData();
  await createStaff(data.db, { name: 'Kaan', role: 'owner', pin: '4821' }, before());
  const waiter = await createStaff(
    data.db,
    { name: 'Ayşe', role: 'cashier', pin: '1234', permissions: grant },
    before(),
  );
  const eti = await createSupplier(data.db, { name: 'Eti' }, at);
  const biskuvi = await createProduct(
    data.db,
    { name: 'Bisküvi', sellPrice: 1500, vatRate: 1 },
    at,
  );
  await recordPurchase(
    data.db,
    {
      deviceCode: 'K1',
      supplierId: eti.id,
      invoiceNo: 'F-77',
      payment: 'on_account',
      lines: [{ productId: biskuvi.id, qtyMilli: 24_000, buyPrice: 1100 }],
    },
    at,
  );
  await signInAs(data.db, waiter.id);
  await renderWithData(
    <SessionProvider>
      <SuppliersSection />
    </SessionProvider>,
    data,
  );
  await userEvent.click(await screen.findByRole('button', { name: 'Eti' }));
  const dialog = await screen.findByRole('dialog', { name: 'Eti' });
  await userEvent.click(await within(dialog).findByRole('button', { name: /Fatura F-77/ }));
  return dialog;
}

afterEach(() => {
  window.location.hash = '';
});

describe('SuppliersSection', () => {
  it('shows what an invoice held, but not what each product cost, without seeCost', async () => {
    const dialog = await invoiced({ suppliers: true });
    const lines = await within(dialog).findByRole('table', { name: 'Fatura F-77' });
    expect(within(lines).getByText('Bisküvi')).toBeInTheDocument();
    expect(within(lines).getByText('24 adet')).toBeInTheDocument();
    expect(within(lines).queryByText('Alış fiyatı')).toBeNull();
    expect(within(lines).queryByText('Tutar')).toBeNull();
    // What the invoice adds up to is what is owed: the supplier's own business.
    expect(within(dialog).getAllByText('₺264,00').length).toBeGreaterThan(0);
  });

  it('shows each product its cost to a person with seeCost', async () => {
    const dialog = await invoiced({ suppliers: true, seeCost: true });
    const lines = await within(dialog).findByRole('table', { name: 'Fatura F-77' });
    expect(within(lines).getByText('Alış fiyatı')).toBeInTheDocument();
    expect(within(lines).getByText('₺11,00')).toBeInTheDocument();
  });
});
