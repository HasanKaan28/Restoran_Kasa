import type { JSX } from 'react';
import type { TabDue } from '@/data/restaurant';
import { Button, ChoiceGroup, TextField } from '@/design';
import { formatTRY, type Kurus } from '@/domain/money';
import { PAYMENT_LABELS } from '@/pos/format';

const TIME = new Intl.DateTimeFormat('tr-TR', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Istanbul',
});

export type ShareMethod = 'cash' | 'card';

const SHARE_METHODS: readonly { value: ShareMethod; label: string }[] = [
  { value: 'cash', label: 'Nakit' },
  { value: 'card', label: 'Kart' },
];

/** An amount as a person types it back ("290,00"), for the field. */
function typedForm(amount: Kurus): string {
  return `${Math.floor(amount / 100)},${String(amount % 100).padStart(2, '0')}`;
}

/**
 * Paying the bill by amount, one guest at a time: what the bill is, what was paid toward it and
 * what is left; the amount this guest pays, in cash or by card; and the shares taken so far, each
 * of which a person allowed to void can give back.
 */
export function SharePanel({
  due,
  amount,
  method,
  given,
  change,
  canGiveBack,
  busy,
  onAmount,
  onMethod,
  onGiven,
  onGiveBack,
}: {
  due: TabDue;
  amount: string;
  method: ShareMethod;
  given: string;
  /** The change on the cash handed over, once it covers the amount. */
  change: Kurus | undefined;
  canGiveBack: boolean;
  busy: boolean;
  onAmount(text: string): void;
  onMethod(method: ShareMethod): void;
  onGiven(text: string): void;
  onGiveBack(partId: string): void;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
        <dt className="text-text-2">Hesap</dt>
        <dd className="text-right font-display font-semibold">{formatTRY(due.bill)}</dd>
        {due.paid > 0 ? (
          <>
            <dt className="text-text-2">Ödenen</dt>
            <dd className="text-right font-display font-semibold">{formatTRY(due.paid)}</dd>
          </>
        ) : null}
        <dt className="font-semibold">Kalan</dt>
        <dd aria-label="Kalan" className="text-right font-display text-lg font-bold">
          {formatTRY(due.due)}
        </dd>
      </dl>
      {due.parts.length > 0 ? (
        <ul aria-label="Alınan ödemeler" className="flex flex-col divide-y divide-line">
          {due.parts.map((part) => {
            const label = `${PAYMENT_LABELS[part.method]} ${formatTRY(part.amount)}`;
            return (
              <li key={part.id} className="flex min-h-11 items-center gap-3">
                <span className="flex-1">
                  {label}
                  <span className="text-text-2">{` · ${TIME.format(new Date(part.occurredAt))}`}</span>
                </span>
                {canGiveBack ? (
                  <Button
                    variant="ghost"
                    className="text-danger"
                    aria-label={`Geri ver: ${label}`}
                    disabled={busy}
                    onClick={() => onGiveBack(part.id)}
                  >
                    Geri ver
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-40">
          <TextField
            label="Tutar"
            inputMode="decimal"
            value={amount}
            onChange={(event) => onAmount(event.target.value)}
          />
        </div>
        <Button disabled={busy || due.due <= 0} onClick={() => onAmount(typedForm(due.due))}>
          Kalanı yaz
        </Button>
      </div>
      <ChoiceGroup<ShareMethod>
        legend="Ödeme"
        name="sharePayment"
        options={SHARE_METHODS}
        value={method}
        onChange={onMethod}
      />
      {method === 'cash' ? (
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-40">
            <TextField
              label="Alınan"
              inputMode="decimal"
              value={given}
              onChange={(event) => onGiven(event.target.value)}
            />
          </div>
          {change !== undefined ? (
            <p className="pb-3 font-medium">{`Para üstü ${formatTRY(change)}`}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
