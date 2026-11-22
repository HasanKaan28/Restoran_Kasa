import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { SessionProvider } from '@/app/SessionProvider';
import { createProduct } from '@/data/products';
import { createStaff } from '@/data/staff';
import { createSupplier, supplierBalance } from '@/data/suppliers';
import { saveDraft } from '@/stock/receiptDraft';
import type { Permission } from '@/domain/permissions';
import { createTestData, renderWithData } from '@/test/renderWithData';
import { scan } from '@/test/scan';
import { signInAs } from '@/test/session';
import { StockSection } from './StockSection';

const before = () => new Date(Date.now() - 60_000);
const milk = {
  barcode: '8690000000017',
  name: 'Süt',
  sellPrice: 4250,
  buyPrice: 3000,
  vatRate: 1,
} as const;

/** A market with an owner and one waiter holding exactly `grant`; the waiter is signed in. */
async function waiterWith(grant: Partial<Record<Permission, boolean>>) {
  const data = createTestData();
  await createStaff(data.db, { name: 'Kaan', role: 'owner', pin: '4821' }, before());
  const waiter = await createStaff(
    data.db,
    { name: 'Ayşe', role: 'cashier', pin: '1234', permissions: grant },
    before(),
  );
  await signInAs(data.db, waiter.id);
  return data;
}

async function show(data: Awaited<ReturnType<typeof waiterWith>>) {
  await renderWithData(
    <SessionProvider>
      <StockSection />
    </SessionProvider>,
    data,
  );
}

afterEach(() => {
  window.location.hash = '';
  localStorage.clear();
});

describe('StockSection', () => {
  it('offers every view to a person with stock and count', async () => {
    await show(await waiterWith({ stock: true, count: true }));
    await screen.findByRole('radio', { name: 'Mal kabul' });
    for (const name of ['Mal kabul', 'Sayım', 'Kritik stok', 'SKT yaklaşanlar']) {
      expect(screen.getByRole('radio', { name })).toBeInTheDocument();
    }
    expect(screen.getAllByRole('radio')).toHaveLength(4);
  });

  it('shows a person who only counts nothing but the count', async () => {
    await show(await waiterWith({ count: true }));
    expect(await screen.findByRole('region', { name: 'Sayım' })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Mal kabul' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Mal kabul' })).toBeNull();
  });

  it('keeps the count from a person who only has stock', async () => {
    await show(await waiterWith({ stock: true }));
    expect(await screen.findByRole('radio', { name: 'Mal kabul' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Kritik stok' })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Sayım' })).toBeNull();
  });

  it('keeps buy prices and money from a person without seeCost', async () => {
    const data = await waiterWith({ stock: true });
    await createProduct(data.db, milk, before());
    await show(data);
    await screen.findByRole('region', { name: 'Mal kabul' });
    await scan(milk.barcode);
    const line = await screen.findByRole('group', { name: 'Süt' });
    expect(within(line).getByLabelText('Miktar')).toBeInTheDocument();
    expect(within(line).queryByLabelText('Alış fiyatı')).toBeNull();
    expect(within(line).queryByLabelText('Satış fiyatı')).toBeNull();
    expect(screen.queryByText(/Toplam/)).toBeNull();
    expect(screen.queryByRole('radio', { name: 'Açık hesap' })).toBeNull();
  });

  it('shows the buy price to a person with seeCost', async () => {
    const data = await waiterWith({ stock: true, seeCost: true });
    await createProduct(data.db, milk, before());
    await show(data);
    await screen.findByRole('region', { name: 'Mal kabul' });
    await scan(milk.barcode);
    const line = await screen.findByRole('group', { name: 'Süt' });
    expect(within(line).getByLabelText('Alış fiyatı')).toBeInTheDocument();
    expect(within(line).queryByLabelText('Satış fiyatı')).toBeNull();
    expect(screen.getByText(/Toplam/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Kritik stok' }));
    expect(await screen.findByText('Kritik stokta ürün yok.')).toBeInTheDocument();
  });

  it('saves a stale typed price or payment of a person without seeCost as nothing', async () => {
    const data = await waiterWith({ stock: true });
    const product = await createProduct(data.db, milk, before());
    const supplier = await createSupplier(data.db, { name: 'Eti' }, before());
    // A draft left on this device by someone who could see costs.
    saveDraft({
      lines: [
        {
          productId: product.id,
          name: 'Süt',
          unit: 'piece',
          qty: '2',
          buyPrice: '1',
          sellPrice: '1',
        },
      ],
      note: '',
      supplierId: supplier.id,
      payment: 'on_account',
    });
    await show(data);
    await screen.findByRole('group', { name: 'Süt' });
    await userEvent.click(screen.getByRole('button', { name: 'Mal kabulü kaydet' }));
    await waitFor(async () => expect(await data.db.purchases.count()).toBe(1));
    expect(await data.db.purchases.toArray()).toMatchObject([
      { payment: 'cash', total: 6000, lines: [{ buyPrice: 3000 }] },
    ]);
    expect(await data.db.cashMovements.count()).toBe(0);
    expect(await supplierBalance(data.db, supplier.id)).toBe(0);
    expect((await data.db.products.get(product.id))?.sellPrice).toBe(4250);
  });

  it('does not open the product form for an unknown barcode of a person who may not add products', async () => {
    const data = await waiterWith({ stock: true, addProduct: false });
    await show(data);
    await screen.findByRole('region', { name: 'Mal kabul' });
    await scan('8690000000099');
    expect(
      await screen.findByText('Bu barkod kayıtlı değil. Ürün eklemek için yetkiniz yok.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Yeni ürün' })).toBeNull();
  });
});
