import { ChevronRight, Minus, Plus, X } from 'lucide-react';
import { useState, type JSX } from 'react';
import { itemLabel } from '@/data/restaurant';
import type { TabItemRecord } from '@/data/types';
import { Button, TextField } from '@/design';
import { formatTRY } from '@/domain/money';
import { formatLineQty } from '@/pos/format';

const STATUS_LABELS: Record<TabItemRecord['status'], string> = {
  new: 'Gönderilmedi',
  held: 'Bekliyor',
  sent: 'Hazırlanıyor',
  ready: 'Hazır',
  void: 'İptal',
};

const STATUS_TONES: Partial<Record<TabItemRecord['status'], string>> = {
  new: 'text-accent',
  ready: 'text-success',
};

export type OrderLineActions = {
  step(item: TabItemRecord, delta: number): void;
  remove(item: TabItemRecord): void;
  note(item: TabItemRecord, note: string): void;
  hold(item: TabItemRecord, hold: boolean): void;
  /** Opens a sent line's own actions (repeat, treat, void). */
  open(item: TabItemRecord): void;
};

/**
 * The order as the paper adisyon lists it: each line with its quantity, state and amount. Lines
 * still being taken change in place; a sent line opens its actions with a tap.
 */
export function OrderLines({
  items,
  amounts,
  actions,
}: {
  items: readonly TabItemRecord[];
  /** What each payable line costs, by item id. */
  amounts: ReadonlyMap<string, number>;
  actions: OrderLineActions;
}): JSX.Element {
  const [noteFor, setNoteFor] = useState<string | null>(null);
  return (
    <ul className="flex flex-col divide-y divide-line">
      {items.map((item) => {
        const amount = amounts.get(item.id);
        const voided = item.status === 'void';
        const details = (
          <div className={`min-w-0 flex-1 ${voided ? 'line-through opacity-60' : ''}`}>
            <p className="leading-snug font-semibold break-words">{itemLabel(item)}</p>
            <p className={`text-sm font-medium ${STATUS_TONES[item.status] ?? 'text-text-2'}`}>
              {`${formatLineQty(item.qtyMilli, item.unit)} · ${
                item.status === 'new' && item.hold
                  ? 'Bekletiliyor'
                  : STATUS_LABELS[item.status]
              }${item.complimentary ? ' · İkram' : ''}`}
            </p>
            {item.options ? (
              <p className="text-sm text-text-2">{item.options.join(' · ')}</p>
            ) : null}
            {item.note ? <p className="text-sm text-accent">{`Not: ${item.note}`}</p> : null}
            {item.voidReason && voided ? (
              <p className="text-sm text-text-2">{item.voidReason}</p>
            ) : null}
          </div>
        );
        const price =
          amount !== undefined ? (
            <span className="shrink-0 pt-0.5 font-display font-semibold">{formatTRY(amount)}</span>
          ) : null;

        if (item.status !== 'new') {
          return (
            <li key={item.id} className="py-1">
              {voided ? (
                <div className="flex items-start gap-3 py-2">{details}</div>
              ) : (
                <button
                  type="button"
                  aria-label={`${itemLabel(item)}: işlemler`}
                  onClick={() => actions.open(item)}
                  className="-mx-2 flex w-[calc(100%+1rem)] items-start gap-3 rounded-control px-2 py-2 text-left hover:bg-bg"
                >
                  {details}
                  {price}
                  <ChevronRight
                    aria-hidden="true"
                    size={18}
                    strokeWidth={1.75}
                    className="mt-0.5 shrink-0 text-muted"
                  />
                </button>
              )}
            </li>
          );
        }

        return (
          <li key={item.id} className="flex flex-col gap-1.5 py-2.5">
            <div className="flex items-start gap-3">
              {details}
              {price}
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <Button
                variant="secondary"
                size="icon"
                aria-label={`Bir azalt: ${item.name}`}
                icon={<Minus aria-hidden="true" size={16} />}
                onClick={() => actions.step(item, -1000)}
              />
              <Button
                variant="secondary"
                size="icon"
                aria-label={`Bir artır: ${item.name}`}
                icon={<Plus aria-hidden="true" size={16} />}
                onClick={() => actions.step(item, 1000)}
              />
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Çıkar: ${item.name}`}
                icon={<X aria-hidden="true" size={16} />}
                onClick={() => actions.remove(item)}
              />
              {noteFor === item.id ? null : (
                <>
                  <Button variant="ghost" className="ml-auto" onClick={() => setNoteFor(item.id)}>
                    Not ekle
                  </Button>
                  <Button
                    variant="ghost"
                    aria-pressed={item.hold === true}
                    className="aria-pressed:bg-warning-bg aria-pressed:text-warning"
                    onClick={() => actions.hold(item, !item.hold)}
                  >
                    Beklet
                  </Button>
                </>
              )}
            </div>
            {noteFor === item.id ? (
              <TextField
                label={`Not: ${item.name}`}
                autoFocus
                defaultValue={item.note ?? ''}
                onBlur={(event) => {
                  actions.note(item, event.target.value);
                  setNoteFor(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.currentTarget.blur();
                  }
                }}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
