import { useLiveQuery } from 'dexie-react-hooks';
import { useId, useState, type JSX } from 'react';
import { useData } from '@/app/appData';
import { useMarketSettings } from '@/app/marketSettings';
import { useSession } from '@/app/session';
import {
  dropUnsent,
  isUnsent,
  itemLabel,
  payTabAmount,
  payTabItems,
  refundTabPart,
  sendUnsent,
  tabBill,
  tabDue,
  tabTitle,
  type BillLine,
} from '@/data/restaurant';
import type { SaleRecord } from '@/data/types';
import { Button, ChoiceGroup, Dialog, TextField } from '@/design';
import { formatTRY } from '@/domain/money';
import { formatLineQty } from '@/pos/format';
import { printReceipt } from '@/pos/printReceipt';
import { buildReceipt } from '@/pos/receipt';
import { loadReceiptSettings, receiptContext } from '@/pos/receiptSettings';
import { buildPreBill, waiterOf } from './preBill';
import { SharePanel, type ShareMethod } from './SharePanel';
import { tenderFor, typedAmount, type Tender } from './tender';

type Mode = 'lines' | 'amount';

const MODES: readonly { value: Mode; label: string }[] = [
  { value: 'lines', label: 'Kalemlerle' },
  { value: 'amount', label: 'Tutar ile öde' },
];

const METHODS: readonly { value: Tender; label: string }[] = [
  { value: 'cash', label: 'Nakit' },
  { value: 'card', label: 'Kart' },
  // Without spaces it fits one line of the three-part track on a 375 px phone.
  { value: 'mixed', label: 'Nakit+Kart' },
];

/**
 * The bill: every line left to pay is ticked; untick some to split the bill by what each person
 * had, or share the total by heads; pay it in cash, by card, or part each. One payment is one
 * receipt. "Tutar ile öde" takes one guest's share by amount instead: the shares are kept until
 * the last one, which records the bill's one sale and receipt. A line the kitchen has not had
 * (still being taken, or a course kept back) is never charged as it stands: the waiter sends it
 * with the bill or takes it off, so nobody pays for food that was never made and no ticket is
 * left on the kitchen's screen for a table already paid.
 */
export function PayDialog({
  tabId,
  onClose,
  onPaid,
}: {
  tabId: string;
  onClose(): void;
  /** `closed` once nothing is left on the tab. */
  onPaid(message: string, closed: boolean): void;
}): JSX.Element {
  const { db, settings, runner } = useData();
  const session = useSession();
  const { cutoffMinutes } = useMarketSettings();
  const all = useLiveQuery(() => tabBill(db, tabId), [db, tabId]);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [method, setMethod] = useState<Tender>('cash');
  const [cashPart, setCashPart] = useState('');
  const [given, setGiven] = useState('');
  const [heads, setHeads] = useState('');
  const [mode, setMode] = useState<Mode>('lines');
  const [shareText, setShareText] = useState('');
  const [shareMethod, setShareMethod] = useState<ShareMethod>('cash');
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  // This device's receipt settings: with printing on, the bill offers the receipt, ticked when
  // every sale is to print by itself.
  const [receipt] = useState(loadReceiptSettings);
  const [printIt, setPrintIt] = useState(receipt.printing && receipt.autoPrint);

  // What the kitchen has had, what was paid toward it by amount, and what is left.
  const owed = useLiveQuery(() => tabDue(db, tabId), [db, tabId]);
  const lines = all?.lines ?? [];
  const unsent = lines.filter((line) => isUnsent(line.item));
  const payable = lines.filter((line) => !isUnsent(line.item));
  const chosen = payable.filter((line) => !skipped.has(line.item.id));
  const chosenIds = chosen.map((line) => line.item.id);
  const selected = useLiveQuery(
    () => tabBill(db, tabId, chosenIds),
    [db, tabId, chosenIds.join(',')],
  );
  // Shares paid by amount come off the sale of the last lines.
  const allChosen = chosen.length === payable.length;
  const sharesPaid = owed?.paid ?? 0;
  const total = Math.max(0, (selected?.total ?? 0) - (allChosen ? sharesPaid : 0));
  const people = Number(heads);
  const share = typedAmount(shareText);
  const shareChange =
    shareMethod === 'cash' && share && cashGivenOf(given) !== undefined
      ? changeOn(cashGivenOf(given)!, share)
      : undefined;
  const cashGiven = typedAmount(given) ?? undefined;
  // The part paid in cash when it is split with a card, while it leaves something for the card.
  const typedCash = typedAmount(cashPart) ?? undefined;
  const cashShare =
    typedCash !== undefined && typedCash > 0 && typedCash < total ? typedCash : undefined;
  const cashDue = method === 'mixed' ? cashShare : total;

  /** The table's name and its waiter's, for the papers; read before the last payment closes it. */
  async function namesOnPaper(): Promise<{ table?: string; waiter?: string }> {
    const tab = await db.tabs.get(tabId);
    if (!tab) {
      return {};
    }
    const [table, waiter] = await Promise.all([tabTitle(db, tab), waiterOf(db, tab)]);
    return { table, ...(waiter ? { waiter } : {}) };
  }

  /** The receipt of a sale just made, when it is to be printed. */
  function printSale(sale: SaleRecord, names: { table?: string; waiter?: string }) {
    if (printIt) {
      printReceipt(
        buildReceipt(sale, { ...receiptContext(settings, receipt), ...names }),
        receipt.paperWidth,
      );
    }
  }

  /** The pre-bill (adisyon) the table asks for: what is on it, and what is left after shares. */
  async function printPreBill() {
    setError(undefined);
    try {
      const due = await tabDue(db, tabId);
      const bill = await tabBill(db, tabId, due.lineIds);
      const names = await namesOnPaper();
      printReceipt(
        buildPreBill(bill, due, { ...receiptContext(settings, receipt), ...names, at: new Date() }),
        receipt.paperWidth,
      );
    } catch {
      setError('Adisyon yazdırılamadı.');
    }
  }

  async function payShare() {
    const amount = typedAmount(shareText);
    if (amount === undefined || amount === null || amount <= 0) {
      setError('Tutarı rakamla girin.');
      return;
    }
    const cashGiven = shareMethod === 'cash' ? typedAmount(given) : undefined;
    if (cashGiven === null) {
      setError('Alınan tutarı rakamla girin.');
      return;
    }
    if (cashGiven !== undefined && cashGiven < amount) {
      setError('Alınan para tutardan az.');
      return;
    }
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const { due } = await tabDue(db, tabId);
      if (amount > due) {
        setError(`Kalan ${formatTRY(due)}; bundan fazlası alınamaz.`);
        return;
      }
      const names = await namesOnPaper();
      const paid = await payTabAmount(
        db,
        {
          tabId,
          method: shareMethod,
          amount,
          ...(cashGiven !== undefined ? { cashGiven } : {}),
          deviceCode: settings.deviceCode,
          staffId: session.staff?.id,
          cutoffMinutes,
        },
        new Date(),
      );
      void runner.run();
      if ('sale' in paid) {
        printSale(paid.sale, names);
        onPaid(`Ödeme alındı: ${formatTRY(amount)}.`, unsent.length === 0);
        return;
      }
      setNotice(`${formatTRY(amount)} alındı. Kalan ${formatTRY(due - amount)}.`);
      setShareText('');
      setGiven('');
    } catch {
      setError('Ödeme kaydedilemedi.');
    } finally {
      setBusy(false);
    }
  }

  async function giveBack(partId: string) {
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const back = await refundTabPart(
        db,
        partId,
        { deviceCode: settings.deviceCode, staffId: session.staff?.id, cutoffMinutes },
        new Date(),
      );
      void runner.run();
      setNotice(`${formatTRY(back.amount)} geri verildi.`);
    } catch {
      setError('Geri verilemedi.');
    } finally {
      setBusy(false);
    }
  }

  async function pay() {
    if (mode === 'amount') {
      await payShare();
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      // The amount of the lines ticked now: the figure on screen is worked out after the window
      // opens and after every tick, so a quick tap can come before it, or while it is the last one.
      const shares = chosenIds.length === payable.length ? (await tabDue(db, tabId)).paid : 0;
      const due = (await tabBill(db, tabId, chosenIds)).total - shares;
      // Named before paying: the last payment closes the tab.
      const names = await namesOnPaper();
      const tender = tenderFor(method, due, { cashPart, given });
      if ('error' in tender) {
        setError(tender.error);
        return;
      }
      const paid = await payTabItems(
        db,
        {
          tabId,
          itemIds: chosenIds,
          payments: tender.payments,
          ...(tender.cashGiven !== undefined ? { cashGiven: tender.cashGiven } : {}),
          deviceCode: settings.deviceCode,
          staffId: session.staff?.id,
          cutoffMinutes,
        },
        new Date(),
      );
      if ('id' in paid) {
        printSale(paid, names);
      }
      const closed = chosen.length === payable.length && unsent.length === 0;
      onPaid(
        chosenIds.length === 0 ? 'Masa kapatıldı.' : `Ödeme alındı: ${formatTRY(due)}.`,
        closed,
      );
    } catch {
      setError('Ödeme kaydedilemedi.');
    } finally {
      setBusy(false);
    }
  }

  /** Sends the lines the kitchen has not had, so they go on the bill, or takes them off it. */
  async function settleUnsent(how: 'send' | 'drop') {
    setBusy(true);
    setError(undefined);
    try {
      await (how === 'send' ? sendUnsent : dropUnsent)(db, tabId, new Date());
      void runner.run();
    } catch {
      setError(how === 'send' ? 'Gönderilemedi.' : 'Çıkarılamadı.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => !next && onClose()}
      title="Hesap"
      size="lg"
      footer={
        <div className="flex items-center gap-4">
          <div className="flex min-w-0 flex-1 flex-col leading-tight">
            <span className="text-sm font-semibold text-text-2">
              {mode === 'amount' ? 'Bu ödeme' : 'Ödenecek'}
            </span>
            <span
              aria-label="Ödenecek tutar"
              className="truncate font-display text-figure font-bold tracking-[-0.02em]"
            >
              {formatTRY(mode === 'amount' ? (share ?? 0) : total)}
            </span>
          </div>
          <Button
            variant="primary"
            size="lg"
            // Not before the lines are in: with none yet, the button would close the table.
            disabled={
              busy ||
              all === undefined ||
              (mode === 'lines' && lines.length > 0 && chosenIds.length === 0) ||
              (mode === 'amount' && (owed?.due ?? 0) <= 0)
            }
            onClick={() => void pay()}
          >
            {lines.length === 0 ? 'Masayı kapat' : 'Ödemeyi al'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {unsent.length > 0 ? (
          <UnsentLines
            lines={unsent}
            busy={busy}
            onSend={() => void settleUnsent('send')}
            onDrop={() => void settleUnsent('drop')}
          />
        ) : null}
        {payable.length > 0 ? (
          <ChoiceGroup<Mode>
            legend="Nasıl ödenecek"
            hideLegend
            name="payMode"
            options={MODES}
            value={mode}
            onChange={(next) => {
              setMode(next);
              setError(undefined);
              setNotice(undefined);
            }}
          />
        ) : null}
        {mode === 'amount' && owed && payable.length > 0 ? (
          <SharePanel
            due={owed}
            amount={shareText}
            method={shareMethod}
            given={given}
            change={shareChange}
            canGiveBack={session.can('voidSale')}
            busy={busy}
            onAmount={(text) => {
              setShareText(text);
              setError(undefined);
            }}
            onMethod={(next) => {
              setShareMethod(next);
              setError(undefined);
            }}
            onGiven={(text) => {
              setGiven(text);
              setError(undefined);
            }}
            onGiveBack={(partId) => void giveBack(partId)}
          />
        ) : null}
        {mode === 'amount' && payable.length > 0 ? null : lines.length === 0 ? (
          <p className="text-text-2">Ödenecek kalem yok. Masa kapatılabilir.</p>
        ) : payable.length === 0 ? null : (
          <ul aria-label="Kalemler" className="flex flex-col divide-y divide-line">
            {payable.map(({ item, amount }) => (
              <li key={item.id}>
                <label className="flex min-h-11 cursor-pointer items-center gap-3">
                  <input
                    type="checkbox"
                    checked={!skipped.has(item.id)}
                    onChange={(event) =>
                      setSkipped((current) => {
                        const next = new Set(current);
                        if (event.target.checked) {
                          next.delete(item.id);
                        } else {
                          next.add(item.id);
                        }
                        return next;
                      })
                    }
                    className="size-5 accent-accent"
                  />
                  <span className="flex min-w-0 flex-1 flex-col py-1.5">
                    <span>{`${formatLineQty(item.qtyMilli, item.unit)} × ${itemLabel(item)}${item.complimentary ? ' (ikram)' : ''}`}</span>
                    {item.options ? (
                      <span className="text-sm text-text-2">{item.options.join(' · ')}</span>
                    ) : null}
                  </span>
                  <span className="font-display font-semibold">{formatTRY(amount)}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
        {mode === 'lines' && sharesPaid > 0 && payable.length > 0 ? (
          <p className="text-text-2">
            {`Tutar ile ${formatTRY(sharesPaid)} ödendi; son kalemlerin ödemesinden düşülür.`}
          </p>
        ) : null}
        {mode === 'lines' && payable.length > 0 ? (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-32">
                <TextField
                  label="Kişi sayısı"
                  inputMode="numeric"
                  value={heads}
                  onChange={(event) => setHeads(event.target.value)}
                />
              </div>
              {Number.isInteger(people) && people > 1 ? (
                <p className="pb-3 text-text-2">{headShares(total, people)}</p>
              ) : null}
            </div>
            <ChoiceGroup<Tender>
              legend="Ödeme"
              name="tabPayment"
              options={METHODS}
              value={method}
              onChange={(next) => {
                setMethod(next);
                setError(undefined);
              }}
            />
            {method === 'mixed' ? (
              <div className="flex flex-wrap items-end gap-3">
                <div className="w-40">
                  <TextField
                    label="Nakit kısmı"
                    inputMode="decimal"
                    value={cashPart}
                    onChange={(event) => {
                      setCashPart(event.target.value);
                      setError(undefined);
                    }}
                  />
                </div>
                {cashShare !== undefined ? (
                  <p className="pb-3 font-medium">{`Kartla ${formatTRY(total - cashShare)}`}</p>
                ) : null}
              </div>
            ) : null}
            {method !== 'card' ? (
              <div className="flex flex-wrap items-end gap-3">
                <div className="w-40">
                  <TextField
                    label="Alınan"
                    inputMode="decimal"
                    value={given}
                    onChange={(event) => {
                      setGiven(event.target.value);
                      setError(undefined);
                    }}
                  />
                </div>
                {cashGiven !== undefined && cashDue !== undefined && cashGiven >= cashDue ? (
                  <p className="pb-3 font-medium">{`Para üstü ${formatTRY(cashGiven - cashDue)}`}</p>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}
        {payable.length > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            {receipt.printing ? (
              <label className="flex min-h-11 cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  checked={printIt}
                  onChange={(event) => setPrintIt(event.target.checked)}
                  className="size-5 accent-accent"
                />
                <span>Fiş yazdır</span>
              </label>
            ) : (
              <span />
            )}
            <Button disabled={busy} onClick={() => void printPreBill()}>
              Adisyon yazdır
            </Button>
          </div>
        ) : null}
        {notice ? (
          <p role="status" className="font-medium text-success">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="font-medium text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

/**
 * What the kitchen has not had, kept off the bill until the waiter sends it with the bill (the
 * course kept back goes now) or takes it off.
 */
function UnsentLines({
  lines,
  busy,
  onSend,
  onDrop,
}: {
  lines: readonly BillLine[];
  busy: boolean;
  onSend(): void;
  onDrop(): void;
}): JSX.Element {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="slip edge-bill flex flex-col gap-2 bg-warning-bg p-3"
    >
      <h3 id={headingId} className="font-semibold">
        Mutfağa gitmemiş kalemler
      </h3>
      <ul className="flex flex-col gap-1">
        {lines.map(({ item, amount }) => (
          <li key={item.id} className="flex items-baseline justify-between gap-3">
            <span>
              {`${formatLineQty(item.qtyMilli, item.unit)} × ${itemLabel(item)}`}
              <span className="text-text-2">
                {item.status === 'held' || item.hold ? ' · bekletiliyor' : ' · gönderilmedi'}
              </span>
            </span>
            <span className="font-display font-semibold">{formatTRY(amount)}</span>
          </li>
        ))}
      </ul>
      <p className="text-sm">
        Hesaba katılmadı. Ödenmeden önce mutfağa gönderin ya da adisyondan çıkarın.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={onSend}>
          Gönder ve hesaba kat
        </Button>
        <Button variant="ghost" className="text-danger" disabled={busy} onClick={onDrop}>
          Adisyondan çıkar
        </Button>
      </div>
    </section>
  );
}

/** Cash handed over as typed: undefined when nothing or nothing readable was typed. */
function cashGivenOf(text: string): number | undefined {
  return typedAmount(text) ?? undefined;
}

/** The change on cash handed over for an amount, once it covers it. */
function changeOn(given: number, amount: number): number | undefined {
  return given >= amount ? given - amount : undefined;
}

/**
 * Each person's share, to the kuruş: an amount that does not divide evenly leaves a kuruş or a few
 * for some, so the shares add up to the bill ("Kişi başı ₺163,33 · 1 kişi ₺163,34").
 */
function headShares(total: number, people: number): string {
  const base = Math.floor(total / people);
  const over = total - base * people;
  return over === 0
    ? `Kişi başı ${formatTRY(base)}`
    : `Kişi başı ${formatTRY(base)} · ${over} kişi ${formatTRY(base + 1)}`;
}
