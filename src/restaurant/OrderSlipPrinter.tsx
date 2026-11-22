import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useData } from '@/app/appData';
import { loadReceiptSettings } from '@/pos/receiptSettings';
import { slipWindowStart, takeNewSlips, type OrderSlip } from './orderSlip';
import { printOrderSlips } from './printOrderSlips';
import { chooseSlipMode, slipPrefsSnapshot, subscribeSlipPrefs } from './slipPrefs';

/** New lines arriving within this of each other (one sync's pages) are printed together. */
const SETTLE_MS = 2_000;
/** However busy the floor, an order waits no longer than this to print. */
const MAX_WAIT_MS = 10_000;

/**
 * Prints an order slip for every new order on the device chosen for it (Settings → Sipariş
 * adisyonu): whenever sent lines change here (an order taken on this device, or brought by a
 * sync), it waits a moment and prints what it has not printed before. Renders nothing.
 */
export function OrderSlipPrinter({
  settleMs = SETTLE_MS,
  maxWaitMs = MAX_WAIT_MS,
  print = printWithReceiptPaper,
}: {
  settleMs?: number;
  maxWaitMs?: number;
  print?: (slips: OrderSlip[]) => Promise<void>;
}): null {
  const { db, settings } = useData();
  const prefs = useSyncExternalStore(subscribeSlipPrefs, slipPrefsSnapshot);
  const here = prefs.mode !== 'off' && prefs.marketId === settings.marketId;
  const since = here ? prefs.since : null;

  // A choice made in another market starts again from now in this one.
  useEffect(() => {
    if (prefs.mode !== 'off' && prefs.marketId !== settings.marketId) {
      chooseSlipMode(prefs.mode, new Date(), settings.marketId);
    }
  }, [prefs, settings.marketId]);

  // Changes whenever a line is sent (or arrives sent) within the window, or a tab arrives.
  const sentNow = useLiveQuery(async () => {
    if (since === null) {
      return null;
    }
    const lines = await db.tabItems
      .where('sentAt')
      .aboveOrEqual(slipWindowStart(since, new Date()))
      .primaryKeys();
    return `${lines.join(',')}|${await db.tabs.count()}`;
  }, [db, since]);

  const deviceNames = { [settings.deviceCode]: settings.deviceName };
  const latest = useRef({ prefs, print, deviceNames, here });
  useEffect(() => {
    latest.current = { prefs, print, deviceNames, here };
  });
  // When the first change not yet printed came: the settling wait never runs past `maxWaitMs`.
  const waitingSince = useRef<number | null>(null);

  useEffect(() => {
    if (sentNow === undefined || sentNow === null) {
      return;
    }
    if (waitingSince.current === null) {
      waitingSince.current = Date.now();
    }
    const left = waitingSince.current + maxWaitMs - Date.now();
    const timer = setTimeout(
      () => {
        waitingSince.current = null;
        const current = latest.current;
        if (current.prefs.mode === 'off' || !current.here) {
          return;
        }
        // Once taken, slips are printed even if the screen changes meanwhile: they are recorded
        // as printed and would never come again.
        takeNewSlips(db, {
          mode: current.prefs.mode,
          since: current.prefs.since,
          now: new Date(),
          deviceNames: current.deviceNames,
        })
          .then((slips) => (slips.length > 0 ? current.print(slips) : undefined))
          .catch((error: unknown) => console.error('Sipariş adisyonu basılamadı', error));
      },
      Math.max(0, Math.min(settleMs, left)),
    );
    return () => clearTimeout(timer);
  }, [db, sentNow, settleMs, maxWaitMs]);

  return null;
}

function printWithReceiptPaper(slips: OrderSlip[]): Promise<void> {
  return printOrderSlips(slips, loadReceiptSettings().paperWidth);
}
