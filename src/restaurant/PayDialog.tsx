import { useLiveQuery } from 'dexie-react-hooks';
import { useState, type JSX } from 'react';
import { useData } from '@/app/appData';
import { useMarketSettings } from '@/app/marketSettings';
import { useSession } from '@/app/session';
import { itemLabel, payTabItems, tabBill } from '@/data/restaurant';
import { Button, ChoiceGroup, Dialog, TextField } from '@/design';
import { formatTRY, parseTRY } from '@/domain/money';
import { formatLineQty } from '@/pos/format';

type Method = 'cash' | 'card';

const METHODS: readonly { value: Method; label: string }[] = [
  { value: 'cash', label: 'Nakit' },
  { value: 'card', label: 'Kart' },
];

/**
 * The bill: every line left to pay is ticked; untick some to split the bill by what each person
 * had, or share the total by heads. One payment is one receipt.
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
  const { db, settings } = useData();
  const session = useSession();
  const { cutoffMinutes } = useMarketSettings();
  const all = useLiveQuery(() => tabBill(db, tabId), [db, tabId]);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [method, setMethod] = useState<Method>('cash');
  const [given, setGiven] = useState('');
  const [heads, setHeads] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const lines = all?.lines ?? [];
  const chosen = lines.filter((line) => !skipped.has(line.item.id));
  const chosenIds = chosen.map((line) => line.item.id);
  const selected = useLiveQuery(
    () => tabBill(db, tabId, chosenIds),
    [db, tabId, chosenIds.join(',')],
  );
  const total = selected?.total ?? 0;
  const people = Number(heads);
  let cashGiven: number | undefined;
  try {
    cashGiven = given.trim() === '' ? undefined : parseTRY(given);
  } catch {
    cashGiven = undefined;
  }

  async function pay() {
    if (method === 'cash' && cashGiven !== undefined && cashGiven < total) {
      setError('Alınan para tutardan az.');
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await payTabItems(
        db,
        {
          tabId,
          itemIds: chosenIds,
          payments: total > 0 ? [{ method, amount: total }] : [],
          ...(method === 'cash' && cashGiven !== undefined ? { cashGiven } : {}),
          deviceCode: settings.deviceCode,
          staffId: session.staff?.id,
          cutoffMinutes,
        },
        new Date(),
      );
      const closed = chosen.length === lines.length;
      onPaid(
        chosenIds.length === 0 ? 'Masa kapatıldı.' : `Ödeme alındı: ${formatTRY(total)}.`,
        closed,
      );
    } catch {
      setError('Ödeme kaydedilemedi.');
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
            <span className="text-sm font-semibold text-text-2">Ödenecek</span>
            <span
              aria-label="Ödenecek tutar"
              className="truncate font-display text-figure font-bold tracking-[-0.02em]"
            >
              {formatTRY(total)}
            </span>
          </div>
          <Button
            variant="primary"
            size="lg"
            disabled={busy || (lines.length > 0 && chosenIds.length === 0)}
            onClick={() => void pay()}
          >
            {lines.length === 0 ? 'Masayı kapat' : 'Ödemeyi al'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {lines.length === 0 ? (
          <p className="text-text-2">Ödenecek kalem yok. Masa kapatılabilir.</p>
        ) : (
          <ul aria-label="Kalemler" className="flex flex-col divide-y divide-line">
            {lines.map(({ item, amount }) => (
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
        {lines.length > 0 ? (
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
                <p className="pb-3 text-text-2">{`Kişi başı ${formatTRY(Math.ceil(total / people))}`}</p>
              ) : null}
            </div>
            <ChoiceGroup<Method>
              legend="Ödeme"
              name="tabPayment"
              options={METHODS}
              value={method}
              onChange={setMethod}
            />
            {method === 'cash' ? (
              <div className="flex flex-wrap items-end gap-3">
                <div className="w-40">
                  <TextField
                    label="Alınan"
                    inputMode="decimal"
                    value={given}
                    onChange={(event) => setGiven(event.target.value)}
                  />
                </div>
                {cashGiven !== undefined && cashGiven >= total ? (
                  <p className="pb-3 font-medium">{`Para üstü ${formatTRY(cashGiven - total)}`}</p>
                ) : null}
              </div>
            ) : null}
          </>
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
