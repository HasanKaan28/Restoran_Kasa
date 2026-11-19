import { describe, expect, it } from 'vitest';
import {
  findDishes,
  formatMenuPrice,
  isPublicMenu,
  menuSections,
  readAddress,
  tableLabel,
  type PublicMenu,
} from './model';

const menu: PublicMenu = {
  name: 'Kebapçı Halil',
  categories: [
    { id: 'c-corba', name: 'Çorbalar' },
    { id: 'c-izgara', name: 'Izgara' },
    { id: 'c-tatli', name: 'Tatlılar' },
  ],
  dishes: [
    { name: 'Şiş kebap', price: 52000, categoryId: 'c-izgara' },
    { name: 'Adana kebap', price: 45000, categoryId: 'c-izgara' },
    { name: 'Ayran', price: 5000 },
    { name: 'Mercimek çorbası', price: 12000, categoryId: 'c-corba', description: 'Limonla' },
    { name: 'Çay', price: 2000 },
  ],
};

describe('the guest menu', () => {
  it('reads the link: the slug after #, the table from ?masa', () => {
    expect(readAddress({ search: '?masa=5', hash: '#Ab3dEf6hIj9kLm2nOp4qRs7tUv' })).toEqual({
      slug: 'Ab3dEf6hIj9kLm2nOp4qRs7tUv',
      table: '5',
    });
    expect(readAddress({ search: '', hash: '#/abc?masa=B%202' })).toEqual({
      slug: 'abc',
      table: 'B 2',
    });
    expect(readAddress({ search: '?masa=%20%20', hash: '' })).toEqual({ slug: '' });
    expect(readAddress({ search: `?masa=${'9'.repeat(40)}`, hash: '#x' }).table).toHaveLength(24);
  });

  it('names the table as the floor does', () => {
    expect(tableLabel('5')).toBe('Masa 5');
    expect(tableLabel('B2')).toBe('Masa B2');
    expect(tableLabel('Masa 7')).toBe('Masa 7');
    expect(tableLabel('masa 7')).toBe('masa 7');
  });

  it('lays the menu out as the order screen does: categories in order, then the rest', () => {
    expect(
      menuSections(menu).map((section) => [section.name, section.dishes.map((d) => d.name)]),
    ).toEqual([
      ['Çorbalar', ['Mercimek çorbası']],
      ['Izgara', ['Adana kebap', 'Şiş kebap']],
      ['Diğer', ['Ayran', 'Çay']],
    ]);
    expect(menuSections({ ...menu, categories: [] }).map((section) => section.name)).toEqual([
      'Menü',
    ]);
    expect(menuSections({ ...menu, dishes: [] })).toEqual([]);
  });

  it('finds dishes by name or description, Turkish letters folded', () => {
    expect(findDishes(menu, '  ')).toBeNull();
    expect(findDishes(menu, 'KEBAP')?.map((dish) => dish.name)).toEqual([
      'Adana kebap',
      'Şiş kebap',
    ]);
    expect(findDishes(menu, 'cay')?.map((dish) => dish.name)).toEqual(['Çay']);
    expect(findDishes(menu, 'limon')?.map((dish) => dish.name)).toEqual(['Mercimek çorbası']);
    expect(findDishes(menu, 'pizza')).toEqual([]);
  });

  it('prints prices as a menu does: whole liras bare, kuruş when there are any', () => {
    expect(formatMenuPrice(45000)).toBe('₺450');
    expect(formatMenuPrice(123450)).toBe('₺1.234,50');
    expect(formatMenuPrice(0)).toBe('₺0');
  });

  it('accepts only an answer shaped like a menu', () => {
    expect(isPublicMenu(menu)).toBe(true);
    expect(
      isPublicMenu({
        ...menu,
        dishes: [
          {
            name: 'Adana',
            price: 1,
            portions: [{ label: 'Yarım', price: 1 }],
            options: [{ name: 'Acı', choices: ['Acılı'] }],
          },
        ],
      }),
    ).toBe(true);
    expect(isPublicMenu(null)).toBe(false);
    expect(isPublicMenu({ name: 'X', categories: [] })).toBe(false);
    expect(isPublicMenu({ ...menu, dishes: [{ name: 'X', price: '1' }] })).toBe(false);
    expect(isPublicMenu({ ...menu, categories: [{ id: 1, name: 'X' }] })).toBe(false);
  });
});
