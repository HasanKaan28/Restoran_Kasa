import { useLiveQuery } from 'dexie-react-hooks';
import type { JSX } from 'react';
import { useData } from '@/app/appData';
import { formatAmount, formatPeriod } from './reportFormat';
import { CardTable } from './CardTable';
import { loadTableReport, type TableReportRow } from './tableReport';

const cells = (row: TableReportRow): string[] => [
  row.name,
  row.tabCount > 0 ? String(row.tabCount) : '—',
  String(row.saleCount),
  formatAmount(row.revenue),
  // "Diğer" (sales on no adisyon) has no per-adisyon average.
  row.tabCount > 0 ? formatAmount(row.average) : '—',
];

/** The tables of a range of business days: how often each was sat at and what it brought. */
export function TableReportView({ from, to }: { from: string; to: string }): JSX.Element {
  const { db } = useData();
  const report = useLiveQuery(() => loadTableReport(db, { from, to }), [db, from, to]);
  return (
    <>
      <div>
        <h2 className="text-lg font-semibold">Masalar</h2>
        <p className="text-sm text-text-2">{formatPeriod(from, to)}</p>
      </div>
      {report ? (
        <CardTable
          caption="Masa analizi"
          columns={[
            { label: 'Masa' },
            { label: 'Adisyon', numeric: true },
            { label: 'Fiş', numeric: true },
            { label: 'Ciro', numeric: true },
            { label: 'Ortalama adisyon', numeric: true },
          ]}
          rows={[
            ...report.rows.map((row) => ({ key: row.key, cells: cells(row) })),
            ...(report.rows.length > 0
              ? [{ key: report.total.key, cells: cells(report.total), strong: true }]
              : []),
          ]}
          empty="Bu dönemde masa satışı yok."
        />
      ) : (
        <p className="text-text-2">Yükleniyor…</p>
      )}
    </>
  );
}
