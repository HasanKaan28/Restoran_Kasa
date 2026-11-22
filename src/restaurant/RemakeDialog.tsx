import { useRef, useState, type JSX } from 'react';
import type { TabItemRecord } from '@/data/types';
import { Button, Dialog, TextField } from '@/design';
import { formatQtyInput, formatQty, parseQuantity } from '@/pos/format';

/**
 * Asks why a line the kitchen already had is made again (it came cold, it was dropped), in the
 * manner of the void's reason: the copy goes to the station at no charge, and the reason is kept
 * for the void and remake report. Of a line of several (four beers) it asks how many: one by
 * default for a counted line, the whole weight for a weighed one.
 */
export function RemakeDialog({
  item,
  onClose,
  onRemake,
}: {
  item: TabItemRecord;
  onClose(): void;
  onRemake(reason: string, qtyMilli: number): Promise<void>;
}): JSX.Element {
  const weighed = item.unit === 'kg';
  const asksQuantity = weighed || item.qtyMilli > 1000;
  const [reason, setReason] = useState('');
  const [quantity, setQuantity] = useState(formatQtyInput(weighed ? item.qtyMilli : 1000));
  const [quantityError, setQuantityError] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  // Read and set at once: a second submit before the first re-renders must not make a second
  // free line.
  const sending = useRef(false);
  return (
    <Dialog
      open
      onOpenChange={(next) => !next && onClose()}
      title={`Tekrar hazırla: ${item.name}`}
      description="Ücretsiz olarak mutfağa yeni fiş gider; hesap değişmez."
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (sending.current) {
            return;
          }
          if (reason.trim() === '') {
            setError('Tekrar hazırlamanın nedenini yazın.');
            return;
          }
          const qtyMilli = asksQuantity
            ? parseQuantity(quantity, weighed ? 'kg' : 'piece')
            : item.qtyMilli;
          if (qtyMilli === null || qtyMilli > item.qtyMilli) {
            setQuantityError(
              `${weighed ? '0 ile' : '1 ile'} ${formatQty(item.qtyMilli)} arasında bir sayı girin.`,
            );
            return;
          }
          setQuantityError(undefined);
          sending.current = true;
          setBusy(true);
          onRemake(reason, qtyMilli)
            .catch(() => setError('Tekrar hazırlanamadı.'))
            .finally(() => {
              sending.current = false;
              setBusy(false);
            });
        }}
      >
        {asksQuantity ? (
          <TextField
            label={weighed ? 'Kaç kg' : 'Kaç adet'}
            inputMode={weighed ? 'decimal' : 'numeric'}
            value={quantity}
            error={quantityError}
            onChange={(event) => setQuantity(event.target.value)}
          />
        ) : null}
        <TextField
          label="Neden"
          autoFocus
          value={reason}
          error={error}
          onChange={(event) => setReason(event.target.value)}
        />
        <Button type="submit" variant="primary" disabled={busy}>
          Tekrar hazırla
        </Button>
      </form>
    </Dialog>
  );
}
