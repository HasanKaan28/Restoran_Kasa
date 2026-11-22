import type { MarketDb } from '@/data/db';
import type { PaymentMethod, ProductUnit } from '@/data/types';
import { divRoundHalfUp, type Kurus } from '@/domain/money';
import { formatPriceInput, formatQtyInput } from '@/pos/format';
import { csvText } from '@/products/exportCsv';
import { buildSummary, loadRange, type SummaryInput } from './summary';

const BOM = String.fromCharCode(0xfeff);
const DELIMITER = ';';
const LINE_END = '\r\n';
const UNIT_NAMES = { piece: 'Adet', kg: 'Kg' } as const;
/** The group of products with no category (or one that is gone). */
const OTHER = 'Diğer';
const byName = new Intl.Collator('tr');

export type DailyReportRow = {
  productId: string;
  name: string;
  unit?: ProductUnit;
  qtyMilli: number;
  net: Kurus;
};

export type DailyReportGroup = {
  categoryId?: string;
  name: string;
  rows: DailyReportRow[];
  /** What the group's rows come to. */
  net: Kurus;
};

export type DailyReport = {
  from: string;
  to: string;
  /** Products sold by category, complimentary lines left out, the largest group first. */
  categories: DailyReportGroup[];
  /** What the sold rows come to. */
  total: Kurus;
  /** Receipts counted: those not voided within the range. */
  salesCount: number;
  byMethod: Record<PaymentMethod, Kurus>;
  /** Lines given at no charge, valued at their menu price (the line discount they carry). */
  complimentary: {
    count: number;
    value: Kurus;
    rows: { productId: string; name: string; unit?: ProductUnit; qtyMilli: number; value: Kurus }[];
  };
  /** Receipts voided within the range: they are in no figure above. */
  voidCount: number;
  voidTotal: Kurus;
  /** Receipts of earlier days voided within the range: their money is off the grand total. */
  earlierVoidCount: number;
  earlierVoidTotal: Kurus;
  /** Returns within the range: already off the grand total. */
  returnCount: number;
  returnTotal: Kurus;
};

/**
 * A day's (or period's) report by product. Built on `buildSummary`, so voids and returns count
 * as everywhere else. A complimentary line is a sale line whose whole price was discounted away
 * (`net` 0, line discount > 0: what a treat on a tab is paid as); it is taken out of the sold
 * rows and listed apart at its menu price.
 */
export function buildDailyReport(
  input: SummaryInput,
  { from, to }: { from: string; to: string },
): DailyReport {
  const summary = buildSummary(input);
  const inRange = new Set(input.sales.map((sale) => sale.id));
  const voided = new Set(input.voids.map((saleVoid) => saleVoid.saleId));
  const isTreat = (line: { net: Kurus; lineDiscount: Kurus }) =>
    line.net === 0 && line.lineDiscount > 0;
  const treats = new Map<
    string,
    { name: string; unit?: ProductUnit; qtyMilli: number; value: Kurus; lines: number }
  >();
  // What the summary's quantity of a product holds of treats, to take off its sold row: the
  // treats of the range's receipts, less those returned or voided (the summary took those off).
  const inSummary = new Map<string, number>();
  const bump = (productId: string, qtyMilli: number) =>
    inSummary.set(productId, (inSummary.get(productId) ?? 0) + qtyMilli);
  for (const sale of input.sales) {
    if (voided.has(sale.id)) {
      continue;
    }
    for (const line of sale.lines.filter(isTreat)) {
      bump(line.productId, line.qtyMilli);
      const found = treats.get(line.productId) ?? {
        name: line.name,
        ...(line.unit ? { unit: line.unit } : {}),
        qtyMilli: 0,
        value: 0,
        lines: 0,
      };
      treats.set(line.productId, {
        ...found,
        qtyMilli: found.qtyMilli + line.qtyMilli,
        value: found.value + line.lineDiscount,
        lines: found.lines + 1,
      });
    }
  }
  // A sale of an earlier day voided now: the summary took its lines off, treats among them.
  for (const saleVoid of input.voids) {
    const sale = input.salesById.get(saleVoid.saleId);
    if (sale && !inRange.has(sale.id)) {
      for (const line of sale.lines.filter(isTreat)) {
        bump(line.productId, -line.qtyMilli);
      }
    }
  }
  // A returned treat comes off the treats too, if its sale is of this range.
  for (const saleReturn of input.returns) {
    if (voided.has(saleReturn.saleId)) {
      continue;
    }
    for (const line of saleReturn.lines) {
      if (line.net !== 0 || line.qtyMilli <= 0) {
        continue;
      }
      bump(line.productId, -line.qtyMilli);
      const found = inRange.has(saleReturn.saleId) ? treats.get(line.productId) : undefined;
      if (!found) {
        continue;
      }
      const back = Math.min(line.qtyMilli, found.qtyMilli);
      const left = found.qtyMilli - back;
      if (left === 0) {
        treats.delete(line.productId);
      } else {
        treats.set(line.productId, {
          ...found,
          qtyMilli: left,
          value: found.value - divRoundHalfUp(found.value * back, found.qtyMilli),
        });
      }
    }
  }

  const productCategory = new Map(input.products.map((p) => [p.id, p.categoryId]));
  const categoryName = new Map(input.categories.map((c) => [c.id, c.name]));
  const groups = new Map<string, DailyReportGroup>();
  for (const sold of summary.productsSold) {
    const qtyMilli = sold.qtyMilli - (inSummary.get(sold.productId) ?? 0);
    if (qtyMilli <= 0 && sold.net === 0) {
      continue;
    }
    const categoryId = productCategory.get(sold.productId);
    const key = categoryId && categoryName.has(categoryId) ? categoryId : '';
    const group = groups.get(key) ?? {
      ...(key ? { categoryId: key } : {}),
      name: key ? (categoryName.get(key) ?? OTHER) : OTHER,
      rows: [],
      net: 0,
    };
    group.rows.push({
      productId: sold.productId,
      name: sold.name,
      ...(sold.unit ? { unit: sold.unit } : {}),
      qtyMilli,
      net: sold.net,
    });
    group.net += sold.net;
    groups.set(key, group);
  }
  const categories = [...groups.values()].sort(
    (a, b) =>
      Number(a.categoryId === undefined) - Number(b.categoryId === undefined) ||
      b.net - a.net ||
      byName.compare(a.name, b.name),
  );

  return {
    from,
    to,
    categories,
    total: categories.reduce((sum, group) => sum + group.net, 0),
    salesCount: summary.salesCount,
    byMethod: summary.byMethod,
    complimentary: {
      count: [...treats.values()].reduce((sum, row) => sum + row.lines, 0),
      value: [...treats.values()].reduce((sum, row) => sum + row.value, 0),
      rows: [...treats]
        .map(([productId, row]) => ({
          productId,
          name: row.name,
          ...(row.unit ? { unit: row.unit } : {}),
          qtyMilli: row.qtyMilli,
          value: row.value,
        }))
        .sort((a, b) => b.value - a.value || byName.compare(a.name, b.name)),
    },
    voidCount: summary.voidCount - summary.earlierVoidCount,
    voidTotal: summary.voidTotal - summary.earlierVoidTotal,
    earlierVoidCount: summary.earlierVoidCount,
    earlierVoidTotal: summary.earlierVoidTotal,
    returnCount: summary.returnCount,
    returnTotal: summary.returnTotal,
  };
}

/** The daily report of the business days `from`–`to` (YYYY-MM-DD), every register. */
export async function loadDailyReport(
  db: MarketDb,
  { from, to }: { from: string; to: string },
): Promise<DailyReport> {
  const [records, products, categories] = await Promise.all([
    loadRange(db, { index: 'businessDate', from, to }),
    db.products.toArray(),
    db.categories.toArray(),
  ]);
  return buildDailyReport({ ...records, products, categories }, { from, to });
}

/** The report as a CSV Excel opens correctly: product rows, group subtotals, then the figures. */
export function dailyReportCsv(report: DailyReport): string {
  const row = (...cells: string[]) => cells.join(DELIMITER);
  const lines = [row('Kategori', 'Ürün', 'Miktar', 'Birim', 'Tutar')];
  for (const group of report.categories) {
    const category = csvText(group.name);
    for (const item of group.rows) {
      lines.push(
        row(
          category,
          csvText(item.name),
          formatQtyInput(item.qtyMilli),
          UNIT_NAMES[item.unit ?? 'piece'],
          formatPriceInput(item.net),
        ),
      );
    }
    lines.push(row(category, 'Ara toplam', '', '', formatPriceInput(group.net)));
  }
  lines.push(row('Genel toplam', '', '', '', formatPriceInput(report.total)));
  lines.push(row('Nakit', '', '', '', formatPriceInput(report.byMethod.cash)));
  lines.push(row('Kart', '', '', '', formatPriceInput(report.byMethod.card)));
  lines.push(row('Veresiye', '', '', '', formatPriceInput(report.byMethod.credit)));
  lines.push(
    row(
      'İkram',
      '',
      String(report.complimentary.count),
      'Kalem',
      formatPriceInput(report.complimentary.value),
    ),
  );
  lines.push(
    row(
      'İptal (genel toplama dahil değil)',
      '',
      String(report.voidCount),
      'Fiş',
      formatPriceInput(report.voidTotal),
    ),
  );
  lines.push(
    row(
      'Önceki günlerin iptali (genel toplamdan düşüldü)',
      '',
      String(report.earlierVoidCount),
      'Fiş',
      formatPriceInput(report.earlierVoidTotal),
    ),
  );
  lines.push(
    row(
      'İade (genel toplamdan düşüldü)',
      '',
      String(report.returnCount),
      'İade',
      formatPriceInput(report.returnTotal),
    ),
  );
  lines.push(row('Fiş sayısı', '', '', '', String(report.salesCount)));
  return BOM + lines.map((line) => line + LINE_END).join('');
}
