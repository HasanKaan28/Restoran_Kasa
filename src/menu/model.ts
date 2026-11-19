import { normalizeForSearch } from '@/data/text';
import type { Kurus } from '@/domain/money';

/** A dish as public_menu answers it (supabase/migrations/20261120120000_qr_menu.sql). */
export type PublicDish = {
  name: string;
  price: Kurus;
  categoryId?: string;
  description?: string;
  portions?: { label: string; price: Kurus }[];
  options?: { name: string; choices: string[] }[];
};

/** What a guest may see of a restaurant: its name, categories in order and live dishes. */
export type PublicMenu = {
  name: string;
  categories: { id: string; name: string }[];
  dishes: PublicDish[];
};

export type MenuSection = { id: string; name: string; dishes: PublicDish[] };

/** Where the link points: the menu's slug, and the table whose card was scanned. */
export type MenuAddress = { slug: string; table?: string };

const MAX_TABLE_LENGTH = 24;

/**
 * `menu.html?masa=5#<slug>`. The slug rides in the fragment, which the browser never sends to a
 * server or in a referrer. A table written after the slug (`#<slug>?masa=5`) is read too.
 */
export function readAddress({ search, hash }: { search: string; hash: string }): MenuAddress {
  const [fragment = '', fragmentQuery = ''] = hash.replace(/^#\/?/, '').split('?');
  const slug = fragment.split(/[&/]/)[0]?.trim() ?? '';
  const table = (
    new URLSearchParams(search).get('masa') ?? new URLSearchParams(fragmentQuery).get('masa')
  )
    ?.trim()
    .slice(0, MAX_TABLE_LENGTH);
  return table ? { slug, table } : { slug };
}

/** A table as the floor names it (tabTitle): "5" reads as a count, so it is "Masa 5". */
export function tableLabel(table: string): string {
  return /^\d+$/.test(table) ? `Masa ${table}` : table;
}

const byName = (a: PublicDish, b: PublicDish) => a.name.localeCompare(b.name, 'tr');

/**
 * The menu as the order screen lays it out (src/restaurant/MenuBrowser.tsx): one section per
 * category with dishes, in the owner's order, then the dishes without one.
 */
export function menuSections(menu: PublicMenu): MenuSection[] {
  const known = new Set(menu.categories.map((category) => category.id));
  const dishes = [...menu.dishes].sort(byName);
  const sections: MenuSection[] = menu.categories.map((category) => ({
    id: category.id,
    name: category.name,
    dishes: dishes.filter((dish) => dish.categoryId === category.id),
  }));
  sections.push({
    id: 'diger',
    name: menu.categories.length > 0 ? 'Diğer' : 'Menü',
    dishes: dishes.filter((dish) => dish.categoryId === undefined || !known.has(dish.categoryId)),
  });
  return sections.filter((section) => section.dishes.length > 0);
}

/** The dishes whose name or description holds the term; null while nothing is typed. */
export function findDishes(menu: PublicMenu, term: string): PublicDish[] | null {
  const needle = normalizeForSearch(term);
  if (needle === '') {
    return null;
  }
  return menu.dishes
    .filter((dish) => normalizeForSearch(`${dish.name} ${dish.description ?? ''}`).includes(needle))
    .sort(byName);
}

const WHOLE = new Intl.NumberFormat('tr-TR', {
  style: 'currency',
  currency: 'TRY',
  maximumFractionDigits: 0,
});
const EXACT = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' });

/** "₺450" for whole liras, as a paper menu prints them; "₺12,50" when there are kuruş. */
export function formatMenuPrice(price: Kurus): string {
  return price % 100 === 0 ? WHOLE.format(price / 100) : EXACT.format(price / 100);
}

const isString = (value: unknown): value is string => typeof value === 'string';
const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;
const listOf = <T>(value: unknown, item: (entry: unknown) => entry is T): value is T[] =>
  Array.isArray(value) && value.every(item);

function isDish(value: unknown): value is PublicDish {
  if (!isObject(value) || !isString(value.name) || !isNumber(value.price)) {
    return false;
  }
  const { categoryId, description, portions, options } = value;
  return (
    (categoryId === undefined || isString(categoryId)) &&
    (description === undefined || isString(description)) &&
    (portions === undefined ||
      listOf(portions, (p): p is { label: string; price: number } =>
        isObject(p) ? isString(p.label) && isNumber(p.price) : false,
      )) &&
    (options === undefined ||
      listOf(options, (o): o is { name: string; choices: string[] } =>
        isObject(o) ? isString(o.name) && listOf(o.choices, isString) : false,
      ))
  );
}

/** True for an answer shaped like a menu; anything else is shown as an error, never drawn. */
export function isPublicMenu(value: unknown): value is PublicMenu {
  return (
    isObject(value) &&
    isString(value.name) &&
    listOf(value.categories, (c): c is { id: string; name: string } =>
      isObject(c) ? isString(c.id) && isString(c.name) : false,
    ) &&
    listOf(value.dishes, isDish)
  );
}
