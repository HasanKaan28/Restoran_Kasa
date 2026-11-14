import { useLiveQuery } from 'dexie-react-hooks';
import { useState, type JSX } from 'react';
import { useData } from '@/app/appData';
import { listDiningTables, mergeTabs, moveTab, openTabs } from '@/data/restaurant';
import { Button, Dialog } from '@/design';

/**
 * Moves a tab to another table: to an empty one it simply moves; onto a table with its own tab
 * the two are merged into that one.
 */
export function MoveDialog({
  tabId,
  onClose,
  onMoved,
}: {
  tabId: string;
  onClose(): void;
  /** `closed` when this tab merged into another and is gone. */
  onMoved(message: string, closed: boolean): void;
}): JSX.Element {
  const { db } = useData();
  const [error, setError] = useState<string>();
  const floor = useLiveQuery(async () => {
    const [tables, tabs] = await Promise.all([listDiningTables(db), openTabs(db)]);
    return tables.map((table) => ({
      table,
      tab: tabs.find((tab) => tab.tableId === table.id),
    }));
  }, [db]);

  async function choose(tableId: string, otherTabId: string | undefined) {
    try {
      if (otherTabId === undefined) {
        await moveTab(db, tabId, tableId, new Date());
        onMoved('Masa taşındı.', false);
      } else {
        await mergeTabs(db, tabId, otherTabId, new Date());
        onMoved('Adisyonlar birleştirildi.', true);
      }
    } catch {
      setError('Taşınamadı.');
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => !next && onClose()}
      title="Taşı / birleştir"
      description="Boş masaya taşınır; dolu masayla adisyonlar birleşir."
    >
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-2">
        {(floor ?? [])
          .filter(({ tab }) => tab?.id !== tabId)
          .map(({ table, tab }) => (
            <li key={table.id}>
              <Button className="w-full" onClick={() => void choose(table.id, tab?.id)}>
                {`${table.name}${tab ? ' (dolu)' : ''}`}
              </Button>
            </li>
          ))}
      </ul>
      {error ? (
        <p role="alert" className="mt-3 font-medium text-danger">
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}
