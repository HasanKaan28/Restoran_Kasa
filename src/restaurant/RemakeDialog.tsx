import { useRef, useState, type JSX } from 'react';
import type { TabItemRecord } from '@/data/types';
import { Button, Dialog, TextField } from '@/design';

/**
 * Asks why a line the kitchen already had is made again (it came cold, it was dropped), in the
 * manner of the void's reason: the copy goes to the station at no charge, and the reason is kept
 * for the void and remake report.
 */
export function RemakeDialog({
  item,
  onClose,
  onRemake,
}: {
  item: TabItemRecord;
  onClose(): void;
  onRemake(reason: string): Promise<void>;
}): JSX.Element {
  const [reason, setReason] = useState('');
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
          sending.current = true;
          setBusy(true);
          onRemake(reason)
            .catch(() => setError('Tekrar hazırlanamadı.'))
            .finally(() => {
              sending.current = false;
              setBusy(false);
            });
        }}
      >
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
