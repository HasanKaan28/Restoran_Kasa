import type { MarketDb } from '@/data/db';
import type { Kurus } from '@/domain/money';
import { tableLabelIn } from '@/restaurant/tableTitle';

export type TableReportRow = {
  key: string;
  name: string;
  kind: 'table' | 'takeaway' | 'other';
  /** Adisyons paid; 0 for sales that belong to no tab. */
  tabCount: number;
  /** Receipts (sales) rung up. */
  saleCount: number;
  revenue: Kurus;
  /** Revenue per adisyon, rounded; per receipt for the sales that belong to no tab. */
  average: Kurus;
};

export type TableReport = { rows: TableReportRow[]; total: TableReportRow };

const rowOf = (
  key: string,
  name: string,
  kind: TableReportRow['kind'],
  tabs: ReadonlySet<string>,
  sales: number,
  revenue: Kurus,
): TableReportRow => {
  const per = tabs.size || sales;
  return {
    key,
    name,
    kind,
    tabCount: tabs.size,
    saleCount: sales,
    revenue,
    average: per > 0 ? Math.round(revenue / per) : 0,
  };
};

/**
 * What each table brought in the business days `from`–`to`: the sales that were not voided, each
 * followed through the lines it paid to the tab and its table. Takeaway tabs (no table) are one
 * row, and sales that paid no tab line (the Market Kasa) are "Diğer". An archived table keeps
 * its name.
 */
export async function loadTableReport(
  db: MarketDb,
  { from, to }: { from: string; to: string },
): Promise<TableReport> {
  const inRange = await db.sales.where('businessDate').between(from, to, true, true).toArray();
  const voided = new Set(
    (
      await db.saleVoids
        .where('saleId')
        .anyOf(inRange.map((sale) => sale.id))
        .toArray()
    ).map((record) => record.saleId),
  );
  const sales = inRange.filter((sale) => !voided.has(sale.id));
  const lines = await db.tabItems
    .where('paidSaleId')
    .anyOf(sales.map((sale) => sale.id))
    .toArray();
  const tabIdOfSale = new Map<string, string>();
  for (const line of lines) {
    if (line.paidSaleId && !tabIdOfSale.has(line.paidSaleId)) {
      tabIdOfSale.set(line.paidSaleId, line.tabId);
    }
  }
  const [tabs, tables] = await Promise.all([
    db.tabs.bulkGet([...new Set(tabIdOfSale.values())]),
    db.diningTables.toArray(),
  ]);
  const tabById = new Map(tabs.flatMap((tab) => (tab ? [[tab.id, tab] as const] : [])));
  const tableById = new Map(tables.map((table) => [table.id, table]));

  type Bucket = {
    name: string;
    kind: TableReportRow['kind'];
    tabs: Set<string>;
    sales: number;
    revenue: Kurus;
  };
  const buckets = new Map<string, Bucket>();
  const add = (
    key: string,
    name: string,
    kind: Bucket['kind'],
    tabId: string | null,
    sale: Kurus,
  ) => {
    const bucket = buckets.get(key) ?? {
      name,
      kind,
      tabs: new Set<string>(),
      sales: 0,
      revenue: 0,
    };
    if (tabId !== null) bucket.tabs.add(tabId);
    bucket.sales += 1;
    bucket.revenue += sale;
    buckets.set(key, bucket);
  };
  for (const sale of sales) {
    const tab = tabById.get(tabIdOfSale.get(sale.id) ?? '');
    if (!tab) add('other', 'Diğer', 'other', null, sale.total);
    else if (tab.tableId === undefined) add('takeaway', 'Paket', 'takeaway', tab.id, sale.total);
    else {
      const table = tableById.get(tab.tableId);
      add(
        `table:${tab.tableId}`,
        table ? tableLabelIn(table, tables) : 'Bilinmeyen masa',
        'table',
        tab.id,
        sale.total,
      );
    }
  }

  const rows = [...buckets.entries()]
    .map(([key, bucket]) =>
      rowOf(key, bucket.name, bucket.kind, bucket.tabs, bucket.sales, bucket.revenue),
    )
    // Tables by revenue; "Diğer" stays last.
    .sort(
      (a, b) =>
        Number(a.kind === 'other') - Number(b.kind === 'other') ||
        b.revenue - a.revenue ||
        a.name.localeCompare(b.name, 'tr'),
    );
  const allTabs = new Set(rows.flatMap((row) => [...(buckets.get(row.key)?.tabs ?? [])]));
  const total = rowOf(
    'total',
    'Toplam',
    'other',
    allTabs,
    rows.reduce((sum, row) => sum + row.saleCount, 0),
    rows.reduce((sum, row) => sum + row.revenue, 0),
  );
  // The average is per adisyon: market sales on no tab are in the revenue but not in it.
  const tabRevenue = rows.reduce((sum, row) => sum + (row.kind === 'other' ? 0 : row.revenue), 0);
  total.average = allTabs.size > 0 ? Math.round(tabRevenue / allTabs.size) : 0;
  return { rows, total };
}
