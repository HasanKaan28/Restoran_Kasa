import { canonicalBarcode, type NewProduct, type ProductPatch } from '@/data/products';
import type { ProductRecord, ProductUnit, Station } from '@/data/types';
import type { GroupDraft, PortionDraft } from '@/restaurant/MenuOptionsEditor';
import type { ChoiceOption } from '@/design';
import { formatTRY, parseTRY, type Kurus } from '@/domain/money';
import { MAX_UNIT_PRICE, type VatRate } from '@/domain/pricing';
import { formatPriceInput, formatQtyInput, formatStock, parseQuantity } from '@/pos/format';

/** Why a weighed product cannot be counted in pieces yet: its stock is not whole. */
export function fractionalStockError(stockMilli: number, unit: ProductUnit): string {
  return `Stok kesirli (${formatStock(stockMilli, unit)}); adede çevirmeden önce stoğu düzeltin.`;
}

/** The product form as typed: every box is text until it is read. */
export type ProductDraft = {
  barcode: string;
  name: string;
  categoryId: string;
  unit: ProductUnit;
  sellPrice: string;
  buyPrice: string;
  vatRate: VatRate;
  criticalLevel: string;
  isQuick: boolean;
  openingStock: string;
  /** Case and pack barcodes as typed; a row left wholly empty is dropped. */
  packs: PackDraft[];
  station: Station;
  /** Portions at their own prices, as typed. */
  portions: PortionDraft[];
  /** Choice groups, the choices typed comma separated. */
  optionGroups: GroupDraft[];
};

export type PackDraft = { barcode: string; qty: string };

export type DraftErrors = Partial<
  Record<
    | 'barcode'
    | 'name'
    | 'sellPrice'
    | 'buyPrice'
    | 'criticalLevel'
    | 'openingStock'
    | 'packs'
    | 'menu',
    string
  >
>;

export type ReadDraft =
  | {
      fields: Required<Omit<NewProduct, 'barcode' | 'categoryId'>> & NewProduct;
      openingStockMilli: number;
    }
  | { errors: DraftErrors };

type ReadFields = Extract<ReadDraft, { fields: unknown }>['fields'];

// Each box of the form and the product field it sets; the opening stock is for new products.
const FIELD_OF: Record<Exclude<keyof ProductDraft, 'openingStock'>, keyof ReadFields> = {
  barcode: 'barcode',
  name: 'name',
  categoryId: 'categoryId',
  unit: 'unit',
  sellPrice: 'sellPrice',
  buyPrice: 'buyPrice',
  vatRate: 'vatRate',
  criticalLevel: 'criticalLevelMilli',
  isQuick: 'isQuick',
  packs: 'packs',
  station: 'station',
  portions: 'portions',
  optionGroups: 'optionGroups',
};

/**
 * The fields whose boxes the user changed since the form opened. A save sends only these, so a
 * price another register changed meanwhile is not written back over (DESIGN §7).
 */
export function editedFields(
  opened: ProductDraft,
  draft: ProductDraft,
  fields: ReadFields,
): ProductPatch {
  const patch: Record<string, unknown> = {};
  for (const [box, field] of Object.entries(FIELD_OF) as [
    keyof typeof FIELD_OF,
    keyof ReadFields,
  ][]) {
    if (draft[box] !== opened[box]) {
      patch[field] = fields[field];
    }
  }
  return patch as ProductPatch;
}

export const STATION_OPTIONS: readonly ChoiceOption<Station>[] = [
  { value: 'kitchen', label: 'Mutfak' },
  { value: 'bar', label: 'Bar' },
  { value: 'none', label: 'Hazırlanmaz' },
];

export const UNIT_OPTIONS: readonly ChoiceOption<ProductUnit>[] = [
  { value: 'piece', label: 'Adet' },
  { value: 'kg', label: 'Kilogram' },
];

const ZERO = /^0+(?:[.,]0+)?$/;

/** The form for a product, or an empty one (with a scanned barcode, if there is one). */
export function draftOf(product?: ProductRecord, barcode?: string): ProductDraft {
  return {
    barcode: product?.barcode ?? barcode ?? '',
    name: product?.name ?? '',
    categoryId: product?.categoryId ?? '',
    unit: product?.unit ?? 'piece',
    sellPrice: product ? formatPriceInput(product.sellPrice) : '',
    buyPrice: product && product.buyPrice > 0 ? formatPriceInput(product.buyPrice) : '',
    // A restaurant's dishes and soft drinks are mostly 10 %; drinks with alcohol are 20 %.
    vatRate: product?.vatRate ?? 10,
    criticalLevel:
      product && product.criticalLevelMilli > 0 ? formatQtyInput(product.criticalLevelMilli) : '',
    isQuick: product?.isQuick ?? false,
    openingStock: '',
    station: product?.station ?? 'kitchen',
    portions: (product?.portions ?? []).map((portion) => ({
      label: portion.label,
      price: formatPriceInput(portion.price),
    })),
    optionGroups: (product?.optionGroups ?? []).map((group) => ({
      name: group.name,
      choices: group.choices.join(', '),
      required: group.required,
    })),
    packs: (product?.packs ?? []).map((pack) => ({
      barcode: pack.barcode,
      qty: formatQtyInput(pack.qtyMilli),
    })),
  };
}

/** The product fields the form holds, or a message for every box that cannot be read. */
export function readDraft(draft: ProductDraft): ReadDraft {
  const errors: DraftErrors = {};
  try {
    canonicalBarcode(draft.barcode);
  } catch {
    errors.barcode = 'Barkod yalnız harf, rakam ve - içerebilir.';
  }
  if (draft.name.trim() === '') {
    errors.name = 'Ürün adı gerekli.';
  }
  const sellPrice = readPrice(draft.sellPrice, 'sellPrice', errors);
  const buyPrice = readPrice(draft.buyPrice, 'buyPrice', errors);
  const criticalLevelMilli = readQuantity(draft.criticalLevel, draft.unit, 'criticalLevel', errors);
  const openingStockMilli = readQuantity(draft.openingStock, draft.unit, 'openingStock', errors);
  const packs = readPacks(draft.packs, draft.unit, errors);
  const portions = readPortions(draft.portions, errors);
  const optionGroups = readGroups(draft.optionGroups, errors);
  if (Object.keys(errors).length > 0) {
    return { errors };
  }
  return {
    fields: {
      barcode: draft.barcode,
      name: draft.name,
      categoryId: draft.categoryId,
      unit: draft.unit,
      sellPrice,
      buyPrice,
      vatRate: draft.vatRate,
      isQuick: draft.isQuick,
      criticalLevelMilli,
      packs,
      station: draft.station,
      portions,
      optionGroups,
    },
    openingStockMilli,
  };
}

/** The portions typed, empty rows dropped; the first that cannot be read is named. */
function readPortions(rows: readonly PortionDraft[], errors: DraftErrors) {
  const portions: { label: string; price: Kurus }[] = [];
  for (const [index, row] of rows.entries()) {
    const name = `Porsiyon ${index + 1}`;
    const label = row.label.trim();
    if (label === '' && row.price.trim() === '') {
      continue;
    }
    if (label === '') {
      errors.menu = `${name}: adını yazın.`;
      return [];
    }
    if (row.price.trim() === '') {
      errors.menu = `${name}: fiyatı girin.`;
      return [];
    }
    let price: Kurus;
    try {
      price = parseTRY(row.price);
    } catch {
      errors.menu = `${name}: geçerli bir fiyat girin.`;
      return [];
    }
    if (price > MAX_UNIT_PRICE) {
      errors.menu = `${name}: fiyat en fazla ${formatTRY(MAX_UNIT_PRICE)} olabilir.`;
      return [];
    }
    if (portions.some((portion) => portion.label === label)) {
      errors.menu = `${name}: bu adla bir porsiyon zaten var.`;
      return [];
    }
    portions.push({ label, price });
  }
  return portions;
}

/** The choice groups typed, empty rows dropped; the first that cannot be read is named. */
function readGroups(rows: readonly GroupDraft[], errors: DraftErrors) {
  const groups: { name: string; choices: string[]; required: boolean }[] = [];
  for (const [index, row] of rows.entries()) {
    const label = `Seçenek grubu ${index + 1}`;
    const name = row.name.trim();
    const choices = row.choices
      .split(',')
      .map((choice) => choice.trim())
      .filter(Boolean);
    if (name === '' && choices.length === 0) {
      continue;
    }
    if (name === '' || choices.length === 0) {
      errors.menu = `${label}: adını ve en az bir seçeneği yazın.`;
      return [];
    }
    groups.push({ name, choices, required: row.required });
  }
  return groups;
}

/** The packs typed, rows left empty dropped; the first row that cannot be read is named. */
function readPacks(
  rows: readonly PackDraft[],
  unit: ProductUnit,
  errors: DraftErrors,
): { barcode: string; qtyMilli: number }[] {
  const packs: { barcode: string; qtyMilli: number }[] = [];
  for (const [index, row] of rows.entries()) {
    const name = `Koli ${index + 1}`;
    if (row.barcode.trim() === '' && row.qty.trim() === '') {
      continue;
    }
    let barcode: string | undefined;
    try {
      barcode = canonicalBarcode(row.barcode);
    } catch {
      errors.packs = `${name}: barkod yalnız harf, rakam ve - içerebilir.`;
      return [];
    }
    if (barcode === undefined) {
      errors.packs = `${name}: barkod gerekli.`;
      return [];
    }
    const qtyMilli = parseQuantity(row.qty.trim(), unit);
    if (qtyMilli === null || qtyMilli <= 0) {
      const fractional = unit === 'piece' && parseQuantity(row.qty.trim(), 'kg') !== null;
      errors.packs = fractional
        ? `${name}: adet için tam sayı girin.`
        : `${name}: içindeki miktarı girin.`;
      return [];
    }
    packs.push({ barcode, qtyMilli });
  }
  return packs;
}

/** What one unit earns at these prices, once both are typed. */
export function profitHint(draft: ProductDraft): string | undefined {
  try {
    const profit = parseTRY(draft.sellPrice) - parseTRY(draft.buyPrice);
    return profit >= 0 ? `Birim kâr: ${formatTRY(profit)}` : 'Alış fiyatı satış fiyatından yüksek.';
  } catch {
    return undefined;
  }
}

/** The sell price is required; an empty buy price means it is not known (0). */
function readPrice(text: string, field: 'sellPrice' | 'buyPrice', errors: DraftErrors): Kurus {
  if (field === 'buyPrice' && text.trim() === '') {
    return 0;
  }
  let price: Kurus;
  try {
    price = parseTRY(text);
  } catch {
    errors[field] = 'Geçerli bir tutar girin.';
    return 0;
  }
  if (price > MAX_UNIT_PRICE) {
    errors[field] = `Fiyat en fazla ${formatTRY(MAX_UNIT_PRICE)} olabilir.`;
  }
  return price;
}

/** An empty box or zero is no quantity; a piece product takes whole numbers only. */
function readQuantity(
  text: string,
  unit: ProductUnit,
  field: 'criticalLevel' | 'openingStock',
  errors: DraftErrors,
): number {
  const value = text.trim();
  if (value === '' || ZERO.test(value)) {
    return 0;
  }
  const qtyMilli = parseQuantity(value, unit);
  if (qtyMilli === null) {
    const fractional = unit === 'piece' && parseQuantity(value, 'kg') !== null;
    errors[field] = fractional ? 'Adet için tam sayı girin.' : 'Geçerli bir miktar girin.';
    return 0;
  }
  return qtyMilli;
}
