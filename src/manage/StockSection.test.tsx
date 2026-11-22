import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { SessionProvider } from '@/app/SessionProvider';
import { createProduct, deleteProduct } from '@/data/products';
import { createStaff } from '@/data/staff';
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
  it('offers every view to a person with stock, seeCost and count', async () => {
    await show(await waiterWith({ stock: true, seeCost: true, count: true }));
    await screen.findByRole('radio', { name: 'Mal kabul' });
    for (const name of ['Mal kabul', 'Sayım', 'Kritik stok', 'SKT yaklaşanlar']) {
      expect(screen.getByRole('radio', { name })).toBeInTheDocument();
    }
    expect(
      within(screen.getByRole('group', { name: 'Göster' })).getAllByRole('radio'),
    ).toHaveLength(4);
  });

  it('shows a person who only counts nothing but the count', async () => {
    await show(await waiterWith({ count: true }));
    expect(await screen.findByRole('region', { name: 'Sayım' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Göster' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Mal kabul' })).toBeNull();
  });

  it('keeps Mal kabul from a person with stock but without seeCost', async () => {
    await show(await waiterWith({ stock: true, count: true }));
    expect(await screen.findByRole('radio', { name: 'Kritik stok' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'SKT yaklaşanlar' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Sayım' })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Mal kabul' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Mal kabul' })).toBeNull();
    await userEvent.click(screen.getByRole('radio', { name: 'Kritik stok' }));
    expect(await screen.findByText('Kritik stokta ürün yok.')).toBeInTheDocument();
  });

  it('keeps the count from a person who only has stock and seeCost', async () => {
    await show(await waiterWith({ stock: true, seeCost: true }));
    expect(await screen.findByRole('radio', { name: 'Mal kabul' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Kritik stok' })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Sayım' })).toBeNull();
  });

  it('does not add a critical product to a receipt for a person who cannot receive', async () => {
    const data = await waiterWith({ stock: true });
    await createProduct(data.db, { ...milk, criticalLevelMilli: 5000 }, before());
    await show(data);
    expect(await screen.findByText('Süt')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Mal kabule ekle/ })).toBeNull();
  });

  it('shows the buy price but not the sell price to seeCost without editProducts', async () => {
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

  it('does not open the product form for an unknown barcode without editProducts', async () => {
    // addProduct is the market's till toggle; the restaurant never offers it, so it does not count.
    const data = await waiterWith({ stock: true, seeCost: true, addProduct: true });
    await show(data);
    await screen.findByRole('region', { name: 'Mal kabul' });
    await scan('8690000000099');
    expect(
      await screen.findByText('Bu barkod kayıtlı değil. Ürün eklemek için yetkiniz yok.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Yeni ürün' })).toBeNull();
  });

  it('says a deleted product cannot be brought back without editProducts', async () => {
    const data = await waiterWith({ stock: true, seeCost: true });
    const gone = await createProduct(data.db, milk, before());
    await deleteProduct(data.db, gone.id, new Date());
    await show(data);
    await screen.findByRole('region', { name: 'Mal kabul' });
    await scan(milk.barcode);
    expect(
      await screen.findByText('Bu ürün silinmiş. Geri getirmek için yetkiniz yok.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Ürünü düzenle' })).toBeNull();
  });
});
