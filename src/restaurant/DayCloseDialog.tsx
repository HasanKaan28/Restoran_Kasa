import { useLiveQuery } from 'dexie-react-hooks';
import { useState, type JSX } from 'react';
import { useData } from '@/app/appData';
import { openTabs, tabBill, tabTitle } from '@/data/restaurant';
import { Button, Dialog } from '@/design';
import { formatTRY } from '@/domain/money';
import { CashDialog } from '@/pos/CashDialog';
import { loadReceiptSettings } from '@/pos/receiptSettings';

/**
 * The restaurant's day close: first the tabs still open (whose bills belong to today), then the
 * till counted against what it should hold and the Z report, as the register has always kept it.
 */
export function DayCloseDialog({
  onClose,
  onDone,
}: {
  onClose(): void;
  onDone(message: string): void;
}): JSX.Element {
  const { db } = useData();
  const [counting, setCounting] = useState(false);
  const open = useLiveQuery(async () => {
    const tabs = await openTabs(db);
    return Promise.all(
      tabs.map(async (tab) => ({
        id: tab.id,
        title: await tabTitle(db, tab),
        total: (await tabBill(db, tab.id)).total,
      })),
    );
  }, [db]);

  if (counting) {
    return (
      <CashDialog
        open
        paperWidth={loadReceiptSettings().paperWidth}
        onClose={onClose}
        onDone={onDone}
      />
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => !next && onClose()}
      title="Gün sonu"
      footer={
        <Button
          variant="primary"
          size="lg"
          disabled={open === undefined}
          onClick={() => setCounting(true)}
        >
          {open && open.length > 0 ? 'Yine de kasayı say' : 'Kasayı say ve günü kapat'}
        </Button>
      }
    >
      {open === undefined ? null : open.length === 0 ? (
        <p className="text-text-2">
          Açık adisyon yok. Kasadaki nakdi sayın; beklenenle karşılaştırılır ve gün sonu raporu (Z)
          kaydedilir.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <p role="status" className="slip edge-bill bg-warning-bg p-3 font-medium">
            {`${open.length} adisyon hâlâ açık. Hesaplarını alın ya da kapatın; açık kalanlar bugünün satışına girmez.`}
          </p>
          <ul aria-label="Açık adisyonlar" className="flex flex-col divide-y divide-line">
            {open.map((tab) => (
              <li key={tab.id} className="flex min-h-11 items-center justify-between gap-3">
                <span className="font-semibold">{tab.title}</span>
                <span className="font-display font-semibold">{formatTRY(tab.total)}</span>
              </li>
            ))}
          </ul>
          <a
            href="#/tables"
            className="inline-flex min-h-touch items-center justify-center rounded-control border border-line-strong px-4 font-semibold no-underline hover:bg-bg"
          >
            Masalara dön
          </a>
        </div>
      )}
    </Dialog>
  );
}
