import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useSyncExternalStore, type JSX } from 'react';
import { useData } from '@/app/appData';
import { formatLineQty } from '@/pos/format';
import { pageSizeRule, PRINTABLE_WIDTH } from '@/pos/printPage';
import { loadReceiptSettings } from '@/pos/receiptSettings';
import { printView } from '@/pos/printView';
import { waiterLine } from '@/pos/receipt';
import { slipDateTime, takeNewSlips, type OrderSlip } from './orderSlip';
import { slipPrefsSnapshot, subscribeSlipPrefs } from './slipPrefs';

/** New lines arriving within this of each other (one sync's pages) are printed together. */
const SETTLE_MS = 2_000;
/** A print that never says it is over stops holding up the next one after this. */
const LONGEST_PRINT_MS = 2 * 60_000;

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

/** The bridge the desktop app's preload script puts on `window.marketKasa.print`. */
type DesktopPrint = {
  /** Prints the page on the computer's default printer with no window; false if it could not. */
  silent(): Promise<boolean>;
};

let queue: Promise<void> = Promise.resolve();

/**
 * Prints slips on paper of the receipt's width: on the desktop app straight to the default
 * printer, elsewhere through the browser's print window. One print at a time: a print asked for
 * while another is under way waits for it, so neither takes the other's page away.
 */
export function printOrderSlips(slips: OrderSlip[], paperWidth: 58 | 80): Promise<void> {
  queue = queue.then(() => printOnce(slips, paperWidth));
  return queue;
}

function printOnce(slips: OrderSlip[], paperWidth: 58 | 80): Promise<void> {
  return new Promise((resolve) => {
    let over = false;
    const finish = () => {
      if (!over) {
        over = true;
        clearTimeout(timer);
        resolve();
      }
    };
    const timer = setTimeout(finish, LONGEST_PRINT_MS);
    window.addEventListener('afterprint', finish, { once: true });
    // The page tidies up after `afterprint`; a silent print may end without one, so it is said.
    const ended = () => {
      if (!over) {
        window.dispatchEvent(new Event('afterprint'));
      }
    };
    printView(
      <OrderSlipsView slips={slips} paperWidth={paperWidth} />,
      (printed) => pageSizeRule(paperWidth, printed.getBoundingClientRect().height),
      () => {
        const desktop = (window as { marketKasa?: { print?: DesktopPrint } }).marketKasa?.print;
        if (!desktop) {
          window.print();
          return;
        }
        desktop
          .silent()
          .catch(() => false)
          .then((printed) => {
            if (!printed) {
              // No printer set up, say: the window lets someone choose one.
              window.print();
            }
            ended();
          }, ended);
      },
    );
  });
}

/** Slips as wide as the printer prints on the given paper, one after the other; printed as shown. */
export function OrderSlipsView({
  slips,
  paperWidth,
}: {
  slips: OrderSlip[];
  paperWidth: 58 | 80;
}): JSX.Element {
  return (
    <div
      style={{ width: `${PRINTABLE_WIDTH[paperWidth]}mm` }}
      className="mx-auto flex max-w-full flex-col divide-y divide-dashed divide-black/40 bg-white text-[13px] leading-snug text-black"
    >
      {slips.map((slip) => (
        <SlipView key={slip.id} slip={slip} />
      ))}
    </div>
  );
}

function SlipView({ slip }: { slip: OrderSlip }): JSX.Element {
  const { date, time } = slipDateTime(slip.sentAt);
  return (
    <article aria-label={`${slip.title} siparişi`} className="flex flex-col gap-2 px-2 py-3">
      <p className="text-center font-semibold">{slip.delivered ? 'Teslim edildi' : 'Sipariş'}</p>
      <p className="text-center text-[18px] font-bold">{slip.title}</p>
      {slip.waiters.length > 0 ? <p>{waiterLine(slip.waiters.join(', '))}</p> : null}
      <div className="flex justify-between">
        <span>{date}</span>
        <span>{time}</span>
      </div>
      <hr className="border-dashed border-black/40" />
      <ul className="flex flex-col gap-1">
        {slip.lines.map((line, index) => (
          <li key={index}>
            <p className="text-[15px] font-semibold">
              {`${formatLineQty(line.qtyMilli, line.unit)} × ${line.label}`}
            </p>
            {line.details.map((detail) => (
              <p key={detail} className="pl-2 text-black/70">
                {detail}
              </p>
            ))}
          </li>
        ))}
      </ul>
    </article>
  );
}
