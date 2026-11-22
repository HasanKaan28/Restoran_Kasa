import { useLiveQuery } from 'dexie-react-hooks';
import { useState, type FormEvent, type JSX } from 'react';
import { useData } from '@/app/appData';
import { TableInUseError } from '@/data/errors';
import { archiveDiningTable, createDiningTable, listDiningTables } from '@/data/restaurant';
import { Button, TextField } from '@/design';
import { SettingsSection } from '@/settings/MarketSections';
import { suggestedRun } from './tableNumbering';
import { tableTitle } from './tableTitle';

const MAX_AT_ONCE = 50;

/**
 * The restaurant's tables: a numbered run added at once in one area, each named its number with
 * the prefix typed before it ("B" and 1 to 5 give B1…B5), and a table taken out of use. The
 * numbers offered start at 1 in each area and go on from the area's own last number.
 */
export function TablesSection({ onDone }: { onDone(message: string): void }): JSX.Element {
  const { db } = useData();
  const tables = useLiveQuery(() => listDiningTables(db), [db]);
  const [area, setArea] = useState('Salon');
  const [prefix, setPrefix] = useState('');
  // What the person typed in the number fields; until then the area's suggestion shows.
  const [typedFrom, setFrom] = useState<string>();
  const [typedTo, setTo] = useState<string>();
  const [error, setError] = useState<string>();

  const suggestion = suggestedRun(tables ?? [], area, prefix);
  const from = typedFrom ?? String(suggestion.from);
  const to = typedTo ?? String(suggestion.to);

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
    const areaKey = area.trim().toLocaleLowerCase('tr') || 'salon';
    const taken = new Set(
      (tables ?? [])
        .filter((table) => table.area.trim().toLocaleLowerCase('tr') === areaKey)
        .map((table) => table.name),
    );
    let added = 0;
    for (let number = first; number <= last; number += 1) {
      const name = `${prefix.trim()}${number}`;
      if (!taken.has(name)) {
        await createDiningTable(db, { name, area }, new Date());
        added += 1;
      }
    }
    setFrom(undefined);
    setTo(undefined);
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
            // A hint under this field alone would lift its label above the row's others.
            placeholder="Ör. B"
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
                          ? `Açık adisyonu olan masa kaldırılamaz (${tableTitle(table.name)}). Önce hesabı alın ya da masayı taşıyın.`
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
