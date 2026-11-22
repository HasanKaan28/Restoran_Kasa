import type { MarketDb } from '@/data/db';
import type { TabItemRecord } from '@/data/types';
import { businessDate } from '@/domain/businessDate';
import type { Kurus } from '@/domain/money';

export const UNKNOWN_PERSON = 'Bilinmiyor';

export type ReceiptVoidRow = {
  id: string;
  receiptNo: string;
  reason: string;
  staffName: string;
  at: string;
  amount: Kurus;
};
export type LineVoidRow = {
  id: string;
  name: string;
  reason: string;
  staffName: string;
  at: string;
  amount: Kurus;
};
export type CancelledTabRow = { id: string; name: string; staffName: string; at: string };
export type RemakeRow = {
  id: string;
  name: string;
  originalName: string;
  reason: string;
  staffName: string;
  at: string;
};

export type VoidReport = {
  receiptVoids: ReceiptVoidRow[];
  lineVoids: LineVoidRow[];
  cancelledTabs: CancelledTabRow[];
  remakes: RemakeRow[];
};

const byTimeDesc = <T extends { at: string }>(rows: T[]): T[] =>
  rows.sort((a, b) => b.at.localeCompare(a.at));

/**
 * What was taken back or made again in the business days `from`–`to`: receipts voided, lines
 * voided after they went to the kitchen, adisyons cancelled, and remade lines. Timestamps are
 * placed in a business day with `cutoffMinutes`. Rows written before the person or the time was
 * kept fall back to `updatedAt` and "Bilinmiyor".
 */
export async function loadVoidReport(
  db: MarketDb,
  { from, to, cutoffMinutes }: { from: string; to: string; cutoffMinutes: number },
): Promise<VoidReport> {
  const within = (at: string) => {
    const day = businessDate(new Date(at), { cutoffMinutes });
    return day >= from && day <= to;
  };
  const [voids, staff, tables, items, cancelled] = await Promise.all([
    db.saleVoids.where('businessDate').between(from, to, true, true).toArray(),
    db.staff.toArray(),
    db.diningTables.toArray(),
    // Lines that were voided after sending, or that remake another: a scan, the table is small.
    db.tabItems
      .filter((item) => item.remakeOf !== undefined || (item.status === 'void' && !!item.sentAt))
      .toArray(),
    db.tabs.where('status').equals('cancelled').toArray(),
  ]);
  const person = (id: string | undefined) =>
    (id === undefined ? undefined : staff.find((member) => member.id === id)?.name) ??
    UNKNOWN_PERSON;

  const sales = await db.sales.bulkGet(voids.map((record) => record.saleId));
  const receiptVoids = byTimeDesc(
    voids.map((record, index) => ({
      id: record.id,
      receiptNo: sales[index]?.receiptNo ?? '—',
      reason: record.reason,
      staffName: person(record.staffId),
      at: record.occurredAt,
      amount: sales[index]?.total ?? 0,
    })),
  );

  const lineVoids = byTimeDesc(
    items
      .filter((item) => item.status === 'void' && !!item.sentAt)
      .map((item) => ({ item, at: item.voidedAt ?? item.updatedAt }))
      .filter(({ at }) => within(at))
      .map(({ item, at }) => ({
        id: item.id,
        name: item.name,
        reason: item.voidReason ?? '',
        staffName: person(item.voidedByStaffId),
        at,
        amount: Math.round((item.unitPrice * item.qtyMilli) / 1000),
      })),
  );

  const tableName = new Map(tables.map((table) => [table.id, table.name]));
  const cancelledTabs = byTimeDesc(
    cancelled
      .map((tab) => ({ tab, at: tab.closedAt ?? tab.updatedAt }))
      .filter(({ at }) => within(at))
      .map(({ tab, at }) => ({
        id: tab.id,
        name: (tab.tableId === undefined ? tab.label : tableName.get(tab.tableId)) ?? 'Adisyon',
        staffName: person(tab.closedByStaffId ?? tab.staffId),
        at,
      })),
  );

  const remakeLines = items.filter(
    (item): item is TabItemRecord & { remakeOf: string } =>
      item.remakeOf !== undefined && within(item.orderedAt),
  );
  const originals = await db.tabItems.bulkGet(remakeLines.map((item) => item.remakeOf));
  const remakes = byTimeDesc(
    remakeLines.map((item, index) => ({
      id: item.id,
      name: item.name,
      originalName: originals[index]?.name ?? '—',
      reason: item.remakeReason ?? '',
      staffName: person(item.staffId),
      at: item.orderedAt,
    })),
  );

  return { receiptVoids, lineVoids, cancelledTabs, remakes };
}
