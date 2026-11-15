import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createProduct } from '@/data/products';
import { createTestData, renderWithData } from '@/test/renderWithData';
import { ProductFormDialog } from './ProductFormDialog';

const at = new Date('2026-11-15T09:00:00Z');

describe('ProductFormDialog portions and choices', () => {
  it('saves portions at their prices and a required choice group', async () => {
    const data = createTestData();
    const adana = await createProduct(
      data.db,
      { name: 'Adana', sellPrice: 45000, vatRate: 10 },
      at,
    );
    const onSaved = vi.fn();
    await renderWithData(
      <ProductFormDialog open product={adana} onClose={vi.fn()} onSaved={onSaved} />,
      data,
    );
    expect(screen.queryByText('Koli / paket barkodları')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Porsiyon ekle' }));
    const portion = screen.getByRole('group', { name: 'Porsiyon 1' });
    await userEvent.type(within(portion).getByLabelText('Porsiyon adı'), 'Yarım');
    await userEvent.type(within(portion).getByLabelText('Fiyatı'), '250');

    await userEvent.click(screen.getByRole('button', { name: 'Seçenek grubu ekle' }));
    const group = screen.getByRole('group', { name: 'Seçenek grubu 1' });
    await userEvent.type(within(group).getByLabelText('Grup adı'), 'Acı');
    await userEvent.type(within(group).getByLabelText('Seçenekler'), 'Acılı, Acısız');
    await userEvent.click(within(group).getByRole('checkbox', { name: 'Zorunlu' }));

    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('Ürün kaydedildi.'));
    expect(await data.db.products.get(adana.id)).toMatchObject({
      portions: [{ label: 'Yarım', price: 25000 }],
      optionGroups: [{ name: 'Acı', choices: ['Acılı', 'Acısız'], required: true }],
    });
  });

  it('says what is wrong with a portion', async () => {
    const data = createTestData();
    const adana = await createProduct(
      data.db,
      { name: 'Adana', sellPrice: 45000, vatRate: 10 },
      at,
    );
    await renderWithData(
      <ProductFormDialog open product={adana} onClose={vi.fn()} onSaved={vi.fn()} />,
      data,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Porsiyon ekle' }));
    const portion = screen.getByRole('group', { name: 'Porsiyon 1' });
    await userEvent.type(within(portion).getByLabelText('Porsiyon adı'), 'Yarım');
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    expect(await screen.findByText('Porsiyon 1: fiyatı girin.')).toBeInTheDocument();
  });
});
