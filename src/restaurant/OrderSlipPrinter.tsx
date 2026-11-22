import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useData } from '@/app/appData';
import { loadReceiptSettings } from '@/pos/receiptSettings';
import { takeNewSlips, type OrderSlip } from './orderSlip';
import { printOrderSlips } from './printOrderSlips';
import { slipPrefsSnapshot, subscribeSlipPrefs } from './slipPrefs';

/** New lines arriving within this of each other (one sync's pages) are printed together. */
const SETTLE_MS = 2_000;

/**
 * Prints an order slip for every new order on the device chosen for it (Settings → Sipariş
 * adisyonu): whenever sent lines change here (an order taken on this device, or brought by a
 * sync), it waits a moment and prints what it has not printed before. Renders nothing.
 */
export function OrderSlipPrinter({
  settleMs = SETTLE_MS,
  print = printWithReceiptPaper,
}: {
  settleMs?: number;
  print?: (slips: OrderSlip[]) => Promise<void>;
}): null {
  const { db } = useData();
  const prefs = useSyncExternalStore(subscribeSlipPrefs, slipPrefsSnapshot);
  const since = prefs.mode === 'off' ? null : prefs.since;
  // Changes whenever a line is sent (or arrives sent) after the choice, or a tab arrives.
  const sentNow = useLiveQuery(async () => {
    if (since === null) {
      return null;
    }
    const lines = await db.tabItems.where('sentAt').aboveOrEqual(since).primaryKeys();
    return `${lines.join(',')}|${await db.tabs.count()}`;
  }, [db, since]);

  const latest = useRef({ prefs, print });
  useEffect(() => {
    latest.current = { prefs, print };
  });

  useEffect(() => {
    if (sentNow === undefined || sentNow === null) {
      return;
    }
    const timer = setTimeout(() => {
      const { prefs: chosen, print: printSlips } = latest.current;
      if (chosen.mode === 'off') {
        return;
      }
      // Once taken, slips are printed even if the screen changes meanwhile: they are recorded
      // as printed and would never come again.
      takeNewSlips(db, { mode: chosen.mode, since: chosen.since, now: new Date() })
        .then((slips) => (slips.length > 0 ? printSlips(slips) : undefined))
        .catch((error: unknown) => console.error('Sipariş adisyonu basılamadı', error));
    }, settleMs);
    return () => clearTimeout(timer);
  }, [db, sentNow, settleMs]);

  return null;
}

function printWithReceiptPaper(slips: OrderSlip[]): Promise<void> {
  return printOrderSlips(slips, loadReceiptSettings().paperWidth);
}
