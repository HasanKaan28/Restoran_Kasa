import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SessionProvider } from '@/app/SessionProvider';
import { createProduct } from '@/data/products';
import { createStaff } from '@/data/staff';
import type { Permission } from '@/domain/permissions';
import { createTestData, renderWithData } from '@/test/renderWithData';
import { signInAs } from '@/test/session';
import { ProductFormDialog } from './ProductFormDialog';

const at = new Date('2026-10-29T09:00:00Z');
const before = () => new Date(Date.now() - 60_000);
const milk = {
  barcode: '8690000000017',
  name: 'Süt',
  sellPrice: 4250,
  buyPrice: 3500,
  vatRate: 1,
} as const;

/** A product, and a waiter holding exactly `grant` editing it. */
async function editing(grant: Partial<Record<Permission, boolean>>, onSaved = vi.fn()) {
  const data = createTestData();
  await createStaff(data.db, { name: 'Kaan', role: 'owner', pin: '4821' }, before());
  const waiter = await createStaff(
    data.db,
    { name: 'Ayşe', role: 'cashier', pin: '1234', permissions: grant },
    before(),
  );
  const product = await createProduct(data.db, milk, at);
  await signInAs(data.db, waiter.id);
  await renderWithData(
    <SessionProvider>
      <ProductFormDialog open product={product} onClose={vi.fn()} onSaved={onSaved} />
    </SessionProvider>,
    data,
  );
  await screen.findByRole('heading', { name: 'Ürünü düzenle' });
  return { data, product };
}

describe('ProductFormDialog access', () => {
  it('hides the buy price, and keeps it when saved, without seeCost', async () => {
    const onSaved = vi.fn();
    const { data, product } = await editing({ editProducts: true }, onSaved);
    expect(screen.queryByLabelText('Alış fiyatı')).toBeNull();
    const name = screen.getByLabelText('Ürün adı');
    await userEvent.clear(name);
    await userEvent.type(name, 'Süt 1 L');
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('Ürün kaydedildi.'));
    expect(await data.db.products.get(product.id)).toMatchObject({
      name: 'Süt 1 L',
      buyPrice: 3500,
    });
  });

  it('shows the buy price to a person with seeCost', async () => {
    await editing({ editProducts: true, seeCost: true });
    expect(await screen.findByLabelText('Alış fiyatı')).toHaveValue('35,00');
  });

  it('keeps stock corrections from a person without stock', async () => {
    await editing({ editProducts: true });
    expect(await screen.findByRole('button', { name: 'Hareketler' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stoğu düzelt' })).toBeNull();
  });

  it('offers stock corrections to a person with stock', async () => {
    await editing({ editProducts: true, stock: true });
    expect(await screen.findByRole('button', { name: 'Stoğu düzelt' })).toBeInTheDocument();
  });

  /** A new product opened by a waiter holding exactly `grant`. */
  async function adding(grant: Partial<Record<Permission, boolean>>, onSaved = vi.fn()) {
    const data = createTestData();
    await createStaff(data.db, { name: 'Kaan', role: 'owner', pin: '4821' }, before());
    const waiter = await createStaff(
      data.db,
      { name: 'Ayşe', role: 'cashier', pin: '1234', permissions: grant },
      before(),
    );
    await signInAs(data.db, waiter.id);
    await renderWithData(
      <SessionProvider>
        <ProductFormDialog open onClose={vi.fn()} onSaved={onSaved} />
      </SessionProvider>,
      data,
    );
    await screen.findByRole('heading', { name: 'Yeni ürün' });
    return data;
  }

  it('asks a new product’s opening stock only of a person with stock', async () => {
    await adding({ editProducts: true, stock: true });
    expect(await screen.findByLabelText('Başlangıç stoğu')).toBeInTheDocument();
  });

  it('hides the opening stock and writes none without stock', async () => {
    const onSaved = vi.fn();
    const data = await adding({ editProducts: true }, onSaved);
    expect(screen.queryByLabelText('Başlangıç stoğu')).toBeNull();
    await userEvent.type(screen.getByLabelText('Ürün adı'), 'Ayran');
    await userEvent.type(screen.getByLabelText('Satış fiyatı'), '40');
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('Ürün eklendi.'));
    expect(await data.db.stockMovements.count()).toBe(0);
  });
});
