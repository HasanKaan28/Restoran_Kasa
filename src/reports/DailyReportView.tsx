import { useLiveQuery } from 'dexie-react-hooks';
import { Download, Printer } from 'lucide-react';
import { useMemo, type JSX } from 'react';
import { useData } from '@/app/appData';
import { useSession } from '@/app/session';
import { Button } from '@/design';
import { downloadText } from '@/products/exportCsv';
import { dailyReportCsv, loadDailyReport } from './dailyReport';
import { DailyReportSheet } from './DailyReportSheet';
import { printDailyReport } from './printDailyReport';
import { formatPeriod } from './reportFormat';

/** The report of a day (or period) by product: on screen as printed, with print/PDF and CSV. */
export function DailyReportView({ from, to }: { from: string; to: string }): JSX.Element {
  const { db, settings } = useData();
  const session = useSession();
  const report = useLiveQuery(() => loadDailyReport(db, { from, to }), [db, from, to]);
  // Fixed per report, so a redraw does not change the time shown on the sheet.
  const shownAt = useMemo(() => (report ? new Date() : undefined), [report]);

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h2 className="text-lg font-semibold">Günlük rapor</h2>
          <p className="text-sm text-text-2">{formatPeriod(from, to)}</p>
        </div>
        {session.can('admin') ? (
          <Button
            icon={<Download aria-hidden="true" size={18} />}
            disabled={!report}
            onClick={() =>
              report && downloadText(`gunluk-rapor-${from}-${to}.csv`, dailyReportCsv(report))
            }
          >
            CSV indir
          </Button>
        ) : null}
        <Button
          variant="primary"
          icon={<Printer aria-hidden="true" size={18} />}
          disabled={!report}
          onClick={() =>
            report &&
            printDailyReport({ marketName: settings.marketName, report, printedAt: new Date() })
          }
        >
          Günlük rapor al
        </Button>
      </div>
      {report ? (
        <div className="rounded-control border border-line bg-surface p-4">
          <DailyReportSheet
            model={{ marketName: settings.marketName, report, printedAt: shownAt ?? new Date() }}
          />
        </div>
      ) : (
        <p className="text-text-2">Yükleniyor…</p>
      )}
    </>
  );
}
