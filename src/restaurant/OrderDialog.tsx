import { useState, type FormEvent, type JSX } from 'react';
import type { OrderInput } from '@/data/restaurant';
import type { ProductRecord } from '@/data/types';
import { Button, ChoiceGroup, Dialog, TextField } from '@/design';
import { formatTRY } from '@/domain/money';

const PLAIN = '';
const NONE = '';

/**
 * Ordering a dish that asks something: its portion (each at its price) and its choices, the
 * required ones first to be answered; a note; and whether it waits for the next course.
 */
export function OrderDialog({
  product,
  onClose,
  onOrder,
}: {
  product: ProductRecord;
  onClose(): void;
  onOrder(input: OrderInput): Promise<void>;
}): JSX.Element {
  const [portion, setPortion] = useState(PLAIN);
  const groups = product.optionGroups ?? [];
  const [chosen, setChosen] = useState<string[]>(() => groups.map(() => NONE));
  const [note, setNote] = useState('');
  const [hold, setHold] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const missing = groups.find((group, index) => group.required && chosen[index] === NONE);
    if (missing) {
      setError(`${missing.name} seçin.`);
      return;
    }
    await onOrder({
      qtyMilli: 1000,
      ...(portion !== PLAIN ? { portion } : {}),
      options: chosen.filter((choice) => choice !== NONE),
      ...(note.trim() ? { note } : {}),
      ...(hold ? { hold: true } : {}),
    });
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()} title={product.name}>
      <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
        {product.portions && product.portions.length > 0 ? (
          <ChoiceGroup<string>
            legend="Porsiyon"
            name="portion"
            wrap
            options={[
              { value: PLAIN, label: `Normal · ${formatTRY(product.sellPrice)}` },
              ...product.portions.map((item) => ({
                value: item.label,
                label: `${item.label} · ${formatTRY(item.price)}`,
              })),
            ]}
            value={portion}
            onChange={setPortion}
          />
        ) : null}
        {groups.map((group, index) => (
          <ChoiceGroup<string>
            key={group.name}
            legend={group.required ? `${group.name} (zorunlu)` : group.name}
            name={`choice-${index}`}
            wrap
            options={[
              ...(group.required ? [] : [{ value: NONE, label: 'Farketmez' }]),
              ...group.choices.map((choice) => ({ value: choice, label: choice })),
            ]}
            value={chosen[index] ?? NONE}
            onChange={(next) =>
              setChosen((current) => current.map((value, at) => (at === index ? next : value)))
            }
          />
        ))}
        <TextField
          label="Not"
          autoComplete="off"
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
        <label className="flex min-h-11 cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={hold}
            onChange={(event) => setHold(event.target.checked)}
            className="size-5 accent-accent"
          />
          Sonra gönder (sıradaki servis)
        </label>
        {error ? (
          <p role="alert" className="font-medium text-danger">
            {error}
          </p>
        ) : null}
        <Button type="submit" variant="primary" size="lg">
          Ekle
        </Button>
      </form>
    </Dialog>
  );
}
