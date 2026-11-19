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

describe('ProductFormDialog for a new dish', () => {
  it('asks the restaurant’s questions first and folds the market’s under “Gelişmiş”', async () => {
    await renderWithData(<ProductFormDialog open onClose={vi.fn()} onSaved={vi.fn()} />);
    const dialog = await screen.findByRole('dialog', { name: 'Yeni ürün' });
    const fields = within(dialog)
      .getAllByRole('textbox')
      .map((field) => field.getAttribute('id'))
      .map((id) => dialog.querySelector(`label[for="${id}"]`)?.textContent);
    expect(fields.slice(0, 2)).toEqual(['Ürün adı', 'Satış fiyatı']);
    const advanced = within(dialog).getByText('Gelişmiş').closest('details');
    expect(advanced).not.toHaveAttribute('open');
    expect(advanced).toContainElement(within(dialog).getByLabelText('Barkod'));
    // A restaurant's dish is 10 % VAT unless the owner says otherwise.
    expect(within(dialog).getByRole('radio', { name: '%10' })).toBeChecked();
  });

  it('makes a category in place and chooses it', async () => {
    const onSaved = vi.fn();
    const { data } = await renderWithData(
      <ProductFormDialog open onClose={vi.fn()} onSaved={onSaved} />,
    );
    await userEvent.type(await screen.findByLabelText('Ürün adı'), 'Künefe');
    await userEvent.type(screen.getByLabelText('Satış fiyatı'), '180');
    await userEvent.click(screen.getByRole('button', { name: 'Yeni kategori' }));
    await userEvent.type(screen.getByLabelText('Yeni kategori adı'), 'Tatlı');
    await userEvent.click(screen.getByRole('button', { name: 'Ekle' }));
    await waitFor(() => expect(screen.getByLabelText('Kategori')).toHaveDisplayValue('Tatlı'));
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('Ürün eklendi.'));
    const [dish] = await data.db.products.toArray();
    const [category] = await data.db.categories.toArray();
    expect(dish?.categoryId).toBe(category?.id);
  });
});
