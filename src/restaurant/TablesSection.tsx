import { useLiveQuery } from 'dexie-react-hooks';
import { useState, type FormEvent, type JSX } from 'react';
import { useData } from '@/app/appData';
import { TableInUseError } from '@/data/errors';
import { archiveDiningTable, createDiningTable, listDiningTables } from '@/data/restaurant';
import { Button, TextField } from '@/design';
import { SettingsSection } from '@/settings/MarketSections';

const MAX_AT_ONCE = 50;

/**
 * The restaurant's tables: a numbered run added at once in one area, each named its number with
 * the prefix typed before it ("B" and 1 to 5 give B1…B5), and a table taken out of use.
 */
export function TablesSection({ onDone }: { onDone(message: string): void }): JSX.Element {
  const { db } = useData();
  const tables = useLiveQuery(() => listDiningTables(db), [db]);
  const [area, setArea] = useState('Salon');
  const [prefix, setPrefix] = useState('');
  const [from, setFrom] = useState('1');
  const [to, setTo] = useState('10');
  const [error, setError] = useState<string>();

  async function addRun(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const first = Number(from);
    const last = Number(to);
    if (
      !Number.isInteger(first) ||
      !Number.isInteger(last) ||
      first < 1 ||
      last < first ||
      last - first + 1 > MAX_AT_ONCE
    ) {
      setError(`İlk ve son numara 1 ya da büyük olmalı; en çok ${MAX_AT_ONCE} masa birden.`);
      return;
    }
    setError(undefined);
    const taken = new Set((tables ?? []).map((table) => table.name));
    let added = 0;
    for (let number = first; number <= last; number += 1) {
      const name = `${prefix.trim()}${number}`;
      if (!taken.has(name)) {
        await createDiningTable(db, { name, area }, new Date());
        added += 1;
      }
    }
    onDone(`${added} masa eklendi.`);
  }

  return (
    <SettingsSection
      id="tables-heading"
      title="Masalar"
      description="Salonun masaları. Bölüm adı masaları gruplar (Salon, Bahçe, Teras)."
    >
      <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => void addRun(event)}>
        <div className="w-36">
          <TextField label="Bölüm" value={area} onChange={(event) => setArea(event.target.value)} />
        </div>
        <div className="w-24">
          <TextField
            label="Ön ek"
            hint="Ör. B"
            value={prefix}
            onChange={(event) => setPrefix(event.target.value)}
          />
        </div>
        <div className="w-20">
          <TextField
            label="İlk no"
            inputMode="numeric"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        </div>
        <div className="w-20">
          <TextField
            label="Son no"
            inputMode="numeric"
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
        </div>
        <Button type="submit" variant="primary">
          Masaları ekle
        </Button>
      </form>
      {error ? (
        <p role="alert" className="font-medium text-danger">
          {error}
        </p>
      ) : null}
      {tables && tables.length > 0 ? (
        <ul aria-label="Masa listesi" className="flex flex-wrap gap-2">
          {tables.map((table) => (
            <li
              key={table.id}
              className="flex items-center gap-1 rounded-control border border-line pl-3"
            >
              <span>{`${table.name} · ${table.area}`}</span>
              <Button
                variant="ghost"
                aria-label={`Kaldır: ${table.name}`}
                onClick={() =>
                  void archiveDiningTable(db, table.id, new Date()).then(
                    () => {
                      setError(undefined);
                      onDone(`${table.name} kaldırıldı.`);
                    },
                    (reason: unknown) =>
                      setError(
                        reason instanceof TableInUseError
                          ? `${table.name} masasında açık adisyon var. Önce hesabı alın ya da masayı taşıyın.`
                          : `${table.name} kaldırılamadı.`,
                      ),
                  )
                }
              >
                Kaldır
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </SettingsSection>
  );
}
