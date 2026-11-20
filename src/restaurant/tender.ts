import type { Payment } from '@/data/types';
import { parseTRY, type Kurus } from '@/domain/money';

/** How a bill is paid: all in cash, all by card, or part in cash and the rest by card. */
export type Tender = 'cash' | 'card' | 'mixed';

/** The payments of one receipt, or why they cannot be taken as typed. */
export type TenderResult = { payments: Payment[]; cashGiven?: Kurus } | { error: string };

/** An amount typed by a person: undefined when nothing was typed, null when it cannot be read. */
export function typedAmount(text: string): Kurus | undefined | null {
  if (text.trim() === '') {
    return undefined;
  }
  try {
    return parseTRY(text);
  } catch {
    return null;
  }
}

/**
 * The payments for a bill of `due`, as the waiter typed them. Part cash part card is one sale
 * with two payments, so the till expects the cash part only and the reports count each method.
 */
export function tenderFor(
  tender: Tender,
  due: Kurus,
  typed: { cashPart: string; given: string },
): TenderResult {
  if (due === 0) {
    return { payments: [] };
  }
  if (tender === 'card') {
    return { payments: [{ method: 'card', amount: due }] };
  }
  const given = typedAmount(typed.given);
  if (given === null) {
    return { error: 'Alınan tutarı rakamla girin.' };
  }
  const cash = tender === 'cash' ? due : typedAmount(typed.cashPart);
  if (cash === null || cash === undefined) {
    return { error: 'Nakit kısmını rakamla girin.' };
  }
  if (tender === 'mixed' && (cash <= 0 || cash >= due)) {
    return { error: 'Nakit kısmı ödenecek tutardan az olmalı; kalanı karttan alınır.' };
  }
  if (given !== undefined && given < cash) {
    return {
      error: tender === 'cash' ? 'Alınan para tutardan az.' : 'Alınan para nakit kısmından az.',
    };
  }
  const payments: Payment[] =
    tender === 'cash'
      ? [{ method: 'cash', amount: due }]
      : [
          { method: 'cash', amount: cash },
          { method: 'card', amount: due - cash },
        ];
  return { payments, ...(given !== undefined ? { cashGiven: given } : {}) };
}
