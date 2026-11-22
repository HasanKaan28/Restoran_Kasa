import type { MarketDb } from '@/data/db';
import type { PaymentMethod, ProductUnit, SaleRecord, TabItemRecord } from '@/data/types';
import { divRoundHalfUp, type Kurus } from '@/domain/money';
import { formatPriceInput, formatQtyInput } from '@/pos/format';
import { csvText } from '@/products/exportCsv';
import { buildSummary, loadRange, type SummaryInput } from './summary';

/** What of a paid tab line the report needs to tell a remake from a treat. */
export type PaidTabLine = Pick<
  TabItemRecord,
  'paidSaleId' | 'productId' | 'qtyMilli' | 'complimentary' | 'remakeOf'
>;
type FreeRows = {
  count: number;
  value: Kurus;
  rows: { productId: string; name: string; unit?: ProductUnit; qtyMilli: number; value: Kurus }[];
};

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
  complimentary: FreeRows;
  /** Lines made again at no charge (Tekrar): kept out of the treats, valued the same way. */
  remade: FreeRows;
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
 * rows and listed apart at its menu price. A remake is such a line too, but listed as "Tekrar",
 * not as a treat: a sale line carries no mark of its own, so it is told by `tabLines` (see
 * `remakeKeys`), and a line that cannot be told for certain stays a treat.
 */
export function buildDailyReport(
  input: SummaryInput & { tabLines?: readonly PaidTabLine[] },
  { from, to }: { from: string; to: string },
): DailyReport {
  const summary = buildSummary(input);
  const inRange = new Set(input.sales.map((sale) => sale.id));
  const voided = new Set(input.voids.map((saleVoid) => saleVoid.saleId));
  const isTreat = (line: { net: Kurus; lineDiscount: Kurus }) =>
    line.net === 0 && line.lineDiscount > 0;
  type Bucket = Map<
    string,
    { name: string; unit?: ProductUnit; qtyMilli: number; value: Kurus; lines: number }
  >;
  const treats: Bucket = new Map();
  const remade: Bucket = new Map();
  const remakes = remakeKeys(input.sales, input.tabLines ?? []);
  // What the summary's quantity of a product holds of treats, to take off its sold row: the
  // treats of the range's receipts, less those returned or voided (the summary took those off).
  const takeBack = (bucket: Bucket, productId: string, qtyMilli: number) => {
    const found = bucket.get(productId);
    if (!found) {
      return;
    }
    const back = Math.min(qtyMilli, found.qtyMilli);
    const left = found.qtyMilli - back;
    if (left === 0) {
      bucket.delete(productId);
    } else {
      bucket.set(productId, {
        ...found,
        qtyMilli: left,
        value: found.value - divRoundHalfUp(found.value * back, found.qtyMilli),
      });
    }
  };
  const inSummary = new Map<string, number>();
  const bump = (productId: string, qtyMilli: number) =>
    inSummary.set(productId, (inSummary.get(productId) ?? 0) + qtyMilli);
  for (const sale of input.sales) {
    if (voided.has(sale.id)) {
      continue;
    }
    for (const line of sale.lines.filter(isTreat)) {
      bump(line.productId, line.qtyMilli);
      const bucket = remakes.has(lineKey(sale.id, line)) ? remade : treats;
      const found = bucket.get(line.productId) ?? {
        name: line.name,
        ...(line.unit ? { unit: line.unit } : {}),
        qtyMilli: 0,
        value: 0,
        lines: 0,
      };
      bucket.set(line.productId, {
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
      if (inRange.has(saleReturn.saleId)) {
        // A return names no line: it comes off the treats first, then the remakes.
        takeBack(treats.has(line.productId) ? treats : remade, line.productId, line.qtyMilli);
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

  const listed = (bucket: Bucket): FreeRows => ({
    count: [...bucket.values()].reduce((sum, row) => sum + row.lines, 0),
    value: [...bucket.values()].reduce((sum, row) => sum + row.value, 0),
    rows: [...bucket]
      .map(([productId, row]) => ({
        productId,
        name: row.name,
        ...(row.unit ? { unit: row.unit } : {}),
        qtyMilli: row.qtyMilli,
        value: row.value,
      }))
      .sort((a, b) => b.value - a.value || byName.compare(a.name, b.name)),
  });

  return {
    from,
    to,
    categories,
    total: categories.reduce((sum, group) => sum + group.net, 0),
    salesCount: summary.salesCount,
    byMethod: summary.byMethod,
    complimentary: listed(treats),
    remade: listed(remade),
    voidCount: summary.voidCount - summary.earlierVoidCount,
    voidTotal: summary.voidTotal - summary.earlierVoidTotal,
    earlierVoidCount: summary.earlierVoidCount,
    earlierVoidTotal: summary.earlierVoidTotal,
    returnCount: summary.returnCount,
    returnTotal: summary.returnTotal,
  };
}

const lineKey = (saleId: string, line: { productId: string; qtyMilli: number }) =>
  `${saleId}|${line.productId}|${line.qtyMilli}`;

/**
 * The sale lines that are certainly remakes, as `saleId|productId|qtyMilli`. A sale line has no
 * link to the tab line it came from, so the two are matched on sale, product and quantity: the
 * key counts only when every free (complimentary) tab line paid in that sale with that product
 * and quantity is a remake. One treat among them makes the key ambiguous, and it stays a treat.
 */
function remakeKeys(sales: readonly SaleRecord[], tabLines: readonly PaidTabLine[]): Set<string> {
  const free = new Map<string, { remakes: number; all: number }>();
  for (const line of tabLines) {
    if (line.paidSaleId === undefined || !line.complimentary) {
      continue;
    }
    const key = lineKey(line.paidSaleId, line);
    const seen = free.get(key) ?? { remakes: 0, all: 0 };
    free.set(key, { remakes: seen.remakes + (line.remakeOf ? 1 : 0), all: seen.all + 1 });
  }
  const certain = new Set<string>();
  for (const sale of sales) {
    for (const line of sale.lines) {
      const seen = free.get(lineKey(sale.id, line));
      if (seen && seen.remakes === seen.all) {
        certain.add(lineKey(sale.id, line));
      }
    }
  }
  return certain;
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
  const tabLines = await db.tabItems
    .where('paidSaleId')
    .anyOf(records.sales.map((sale) => sale.id))
    .toArray();
  return buildDailyReport({ ...records, products, categories, tabLines }, { from, to });
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
    row('Tekrar', '', String(report.remade.count), 'Kalem', formatPriceInput(report.remade.value)),
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
