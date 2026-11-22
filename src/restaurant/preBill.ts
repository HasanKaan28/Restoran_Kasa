import type { MarketDb } from '@/data/db';
import { itemLabel, type TabBill, type TabDue } from '@/data/restaurant';
import type { TabRecord } from '@/data/types';
import { formatTRY } from '@/domain/money';
import { formatLineQty } from '@/pos/format';
import { waiterLine, type ReceiptContext, type ReceiptModel } from '@/pos/receipt';

const NOT_A_RECEIPT = 'Ödeme fişi değildir.';

const DATE_TIME = new Intl.DateTimeFormat('tr-TR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Istanbul',
});

/** The name of the waiter who opened a tab, when staff are set up. */
export async function waiterOf(db: MarketDb, tab: TabRecord): Promise<string | undefined> {
  return tab.staffId ? (await db.staff.get(tab.staffId))?.name : undefined;
}

/**
 * The pre-bill (ön hesap, adisyon) a table asks for before paying: what is on the bill, what
 * was paid toward it by amount and what is left. It is drawn and printed like a receipt but says
 * it is none: the receipt is the sale's, once paid.
 */
export function buildPreBill(
  bill: TabBill,
  due: Pick<TabDue, 'paid' | 'due'>,
  context: Pick<ReceiptContext, 'marketName' | 'deviceName' | 'header' | 'table' | 'waiter'> & {
    at: Date;
  },
): ReceiptModel {
  return {
    header: [context.marketName, ...textLines(context.header)],
    device: context.deviceName,
    receiptNo: '',
    heading: 'ÖN HESAP (ADİSYON)',
    dateTime: DATE_TIME.format(context.at),
    ...(context.table ? { table: context.table } : {}),
    ...(context.waiter ? { waiter: waiterLine(context.waiter) } : {}),
    lines: bill.lines.map(({ item, price, amount }) => ({
      name: itemLabel(item),
      detail: `${formatLineQty(item.qtyMilli, item.unit)} × ${formatTRY(price)}`,
      ...(item.remakeOf ? { discount: 'Tekrar' } : item.complimentary ? { discount: 'İkram' } : {}),
      amount: formatTRY(amount),
    })),
    totals: [
      { label: 'Toplam', amount: formatTRY(bill.total) },
      ...(due.paid > 0
        ? [
            { label: 'Ödenen', amount: `−${formatTRY(due.paid)}` },
            { label: 'Kalan', amount: formatTRY(due.due) },
          ]
        : []),
    ],
    vat: [],
    payments: [],
    marks: [],
    footer: [NOT_A_RECEIPT],
  };
}

function textLines(text: string | undefined): string[] {
  return (text ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}
