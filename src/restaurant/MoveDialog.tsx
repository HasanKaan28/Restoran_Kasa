import { useLiveQuery } from 'dexie-react-hooks';
import { useState, type JSX } from 'react';
import { useData } from '@/app/appData';
import { listDiningTables, mergeTabs, moveTab, openTabs } from '@/data/restaurant';
import { Button, Dialog } from '@/design';
import { tableTitle } from './tableTitle';

/**
 * Moves a tab to another table: to an empty one it simply moves; onto a table with its own tab
 * the two are merged into that one, once confirmed, since merged tabs cannot be parted again.
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
  const [merging, setMerging] = useState<{ name: string; tabId: string } | null>(null);
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
      {merging ? (
        <div className="flex flex-col gap-3">
          <p className="font-medium">
            {`Bu adisyon ${tableTitle(merging.name)} ile birleşsin mi? Birleşen adisyonlar yeniden ayrılamaz.`}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => void choose('', merging.tabId)}>
              Birleştir
            </Button>
            <Button onClick={() => setMerging(null)}>Vazgeç</Button>
          </div>
        </div>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-2">
          {(floor ?? [])
            .filter(({ tab }) => tab?.id !== tabId)
            .map(({ table, tab }) => (
              <li key={table.id}>
                <Button
                  className="w-full"
                  onClick={() =>
                    tab
                      ? setMerging({ name: table.name, tabId: tab.id })
                      : void choose(table.id, undefined)
                  }
                >
                  {`${table.name}${tab ? ' (dolu)' : ''}`}
                </Button>
              </li>
            ))}
        </ul>
      )}
      {error ? (
        <p role="alert" className="mt-3 font-medium text-danger">
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}
