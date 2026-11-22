import type { MarketDb } from '@/data/db';
import { businessDate } from '@/domain/businessDate';
import type { Kurus } from '@/domain/money';

/** What one person did over a run of business days. */
export type StaffStat = {
  staffId: string;
  /** Order lines taken, remakes left out (a remake is the kitchen's second try, not a new order). */
  orders: number;
  /** Lines made again at no charge that carry this person's name as the one who ordered. */
  remakes: number;
  tabsOpened: number;
  /** Sales rung up by this person and not cancelled since. */
  billsClosed: number;
  salesTotal: Kurus;
  /** Lines taken back by this person; lines voided before the name was kept are not counted. */
  voidedLines: number;
  /** Whole sales cancelled by this person. */
  voidedSales: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function emptyStat(staffId: string): StaffStat {
  return {
    staffId,
    orders: 0,
    remakes: 0,
    tabsOpened: 0,
    billsClosed: 0,
    salesTotal: 0,
    voidedLines: 0,
    voidedSales: 0,
  };
}

/**
 * Each person's work for the business days `from` to `to` (YYYY-MM-DD, both included). Only
 * people with something in the period are returned; records with no staff are left out.
 */
export async function loadStaffStats(
  db: MarketDb,
  { from, to, cutoffMinutes }: { from: string; to: string; cutoffMinutes: number },
): Promise<StaffStat[]> {
  const stats = new Map<string, StaffStat>();
  const of = (staffId: string): StaffStat => {
    let stat = stats.get(staffId);
    if (!stat) {
      stat = emptyStat(staffId);
      stats.set(staffId, stat);
    }
    return stat;
  };
  const inPeriod = (iso: string | undefined): boolean => {
    if (!iso) {
      return false;
    }
    const day = businessDate(new Date(iso), { cutoffMinutes });
    return day >= from && day <= to;
  };

  // The day's edge moves with the cutoff, so read a day either side of the period off the index
  // and let the business day decide.
  const lo = new Date(Date.parse(`${from}T00:00:00Z`) - 2 * DAY_MS).toISOString();
  const hi = new Date(Date.parse(`${to}T00:00:00Z`) + 3 * DAY_MS).toISOString();
  const [tabs, items, sales, saleVoids] = await Promise.all([
    db.tabs.where('openedAt').between(lo, hi).toArray(),
    // Order lines have no date index; the table is read once, which a restaurant's day keeps small.
    db.tabItems.toArray(),
    db.sales.where('businessDate').between(from, to, true, true).toArray(),
    db.saleVoids.where('businessDate').between(from, to, true, true).toArray(),
  ]);

  for (const tab of tabs) {
    if (tab.staffId && inPeriod(tab.openedAt)) {
      of(tab.staffId).tabsOpened += 1;
    }
  }
  for (const item of items) {
    if (item.staffId && inPeriod(item.orderedAt)) {
      if (item.remakeOf) {
        of(item.staffId).remakes += 1;
      } else {
        of(item.staffId).orders += 1;
      }
    }
    if (item.status === 'void' && item.voidedByStaffId && inPeriod(item.voidedAt)) {
      of(item.voidedByStaffId).voidedLines += 1;
    }
  }

  // A sale cancelled on any day no longer counts as takings.
  const cancelled = new Set(
    (
      await db.saleVoids
        .where('saleId')
        .anyOf(sales.map((sale) => sale.id))
        .toArray()
    ).map((voided) => voided.saleId),
  );
  for (const sale of sales) {
    if (sale.staffId && !cancelled.has(sale.id)) {
      const stat = of(sale.staffId);
      stat.billsClosed += 1;
      stat.salesTotal += sale.total;
    }
  }
  for (const voided of saleVoids) {
    if (voided.staffId) {
      of(voided.staffId).voidedSales += 1;
    }
  }

  return [...stats.values()];
}
