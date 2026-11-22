import { useLiveQuery } from 'dexie-react-hooks';
import type { JSX } from 'react';
import { useData } from '@/app/appData';
import { useMarketSettings } from '@/app/marketSettings';
import { formatAmount, formatPeriod } from './reportFormat';
import { CardTable } from './CardTable';
import { loadVoidReport } from './voidReport';

const timeFormat = new Intl.DateTimeFormat('tr-TR', {
  timeZone: 'Europe/Istanbul',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

const when = (at: string) => timeFormat.format(new Date(at));

/** The lines taken back and made again in a range of business days, and by whom. */
export function VoidReportView({ from, to }: { from: string; to: string }): JSX.Element {
  const { db } = useData();
  const { cutoffMinutes } = useMarketSettings();
  const report = useLiveQuery(
    () => loadVoidReport(db, { from, to, cutoffMinutes }),
    [db, from, to, cutoffMinutes],
  );
  return (
    <>
      <div>
        <h2 className="text-lg font-semibold">İptal / tekrar</h2>
        <p className="text-sm text-text-2">{formatPeriod(from, to)}</p>
      </div>
      {report ? (
        <>
          <p className="text-sm text-text-2">
            {`${report.receiptVoids.length} fiş iptali · ${report.lineVoids.length} satır iptali · ${report.cancelledTabs.length} iptal adisyon · ${report.remakes.length} tekrar`}
          </p>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,340px),1fr))] gap-4">
            <CardTable
              caption="Fiş iptalleri"
              columns={[
                { label: 'Fiş' },
                { label: 'Sebep' },
                { label: 'Kim' },
                { label: 'Zaman' },
                { label: 'Tutar', numeric: true },
              ]}
              rows={report.receiptVoids.map((row) => ({
                key: row.id,
                cells: [
                  row.receiptNo,
                  row.reason,
                  row.staffName,
                  when(row.at),
                  formatAmount(row.amount),
                ],
              }))}
            />
            <CardTable
              caption="Mutfağa gitmiş satır iptalleri"
              columns={[
                { label: 'Ürün' },
                { label: 'Sebep' },
                { label: 'Kim' },
                { label: 'Zaman' },
                { label: 'Tutar', numeric: true },
              ]}
              rows={report.lineVoids.map((row) => ({
                key: row.id,
                cells: [
                  row.name,
                  row.reason || '—',
                  row.staffName,
                  when(row.at),
                  formatAmount(row.amount),
                ],
              }))}
            />
            <CardTable
              caption="İptal adisyonlar"
              columns={[{ label: 'Adisyon' }, { label: 'Kim' }, { label: 'Zaman' }]}
              rows={report.cancelledTabs.map((row) => ({
                key: row.id,
                cells: [row.name, row.staffName, when(row.at)],
              }))}
            />
            <CardTable
              caption="Tekrarlar"
              columns={[
                { label: 'Ürün' },
                { label: 'Asıl ürün' },
                { label: 'Sebep' },
                { label: 'Kim' },
                { label: 'Zaman' },
              ]}
              rows={report.remakes.map((row) => ({
                key: row.id,
                cells: [row.name, row.originalName, row.reason || '—', row.staffName, when(row.at)],
              }))}
            />
          </div>
        </>
      ) : (
        <p className="text-text-2">Yükleniyor…</p>
      )}
    </>
  );
}
