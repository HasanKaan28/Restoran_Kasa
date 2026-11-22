import { useLiveQuery } from 'dexie-react-hooks';
import { Download, MoonStar, Printer } from 'lucide-react';
import { useId, useState, type JSX } from 'react';
import { useData } from '@/app/appData';
import { useSession } from '@/app/session';
import { Button, ToastRegion, useToast } from '@/design';
import { DayCloseDialog } from '@/restaurant/DayCloseDialog';
import { downloadText } from '@/products/exportCsv';
import { printReport } from './printReport';
import { soldProductsCsv } from './reportCsv';
import { formatPeriod, reportFigures, type Figure } from './reportFormat';
import { ReportTables } from './ReportTables';
import { loadSummary, type Summary } from './summary';

/** The register a report is limited to (none for every register), and how it is named. */
export type RegisterChoice = { deviceCode?: string; label: string };

/**
 * The sales of a range of business days, for one register or all of them: the figures, the
 * tables, and from here the CSV, the printout and the day close.
 */
export function SalesReport({
  from,
  to,
  register,
}: {
  from: string;
  to: string;
  register: RegisterChoice;
}): JSX.Element {
  const { db, settings, runner } = useData();
  const session = useSession();
  const toast = useToast();
  const [closing, setClosing] = useState(false);
  const seeCost = session.can('seeCost');
  const { deviceCode } = register;
  const summary = useLiveQuery(
    () => loadSummary(db, { from, to, ...(deviceCode === undefined ? {} : { deviceCode }) }),
    [db, from, to, deviceCode],
  );

  function exportCsv(shown: Summary) {
    downloadText(`satislar-${from}-${to}.csv`, soldProductsCsv(shown));
  }

  function print(shown: Summary) {
    printReport({
      marketName: settings.marketName,
      from,
      to,
      register: register.label,
      summary: shown,
      showCost: seeCost,
      printedAt: new Date(),
    });
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h2 className="text-lg font-semibold">Satışlar</h2>
          <p className="text-sm text-text-2">{`${formatPeriod(from, to)} · ${register.label}`}</p>
        </div>
        {session.can('admin') ? (
          <Button
            icon={<Download aria-hidden="true" size={18} />}
            disabled={!summary}
            onClick={() => summary && exportCsv(summary)}
          >
            CSV indir
          </Button>
        ) : null}
        <Button
          icon={<Printer aria-hidden="true" size={18} />}
          disabled={!summary}
          onClick={() => summary && print(summary)}
        >
          Yazdır
        </Button>
        {session.can('closeDay') ? (
          <Button
            variant="primary"
            icon={<MoonStar aria-hidden="true" size={18} />}
            onClick={() => setClosing(true)}
          >
            Gün sonu
          </Button>
        ) : null}
      </div>
      {summary ? (
        <ReportSummary summary={summary} seeCost={seeCost} />
      ) : (
        <p className="text-text-2">Yükleniyor…</p>
      )}
      {closing ? (
        <DayCloseDialog
          onClose={() => setClosing(false)}
          onDone={(message) => {
            toast.show(message);
            void runner.run();
          }}
        />
      ) : null}
      <ToastRegion message={toast.message} />
    </>
  );
}

/** A summary's figures and tables, as computed now or as saved. */
export function ReportSummary({
  summary,
  seeCost,
}: {
  summary: Summary;
  seeCost: boolean;
}): JSX.Element {
  const [hero, ...figures] = reportFigures(summary, { cost: seeCost });
  return (
    <>
      <section aria-label="Özet" className="flex flex-wrap gap-3">
        {hero ? <FigureTile figure={hero} hero /> : null}
        <div className="grid flex-[2_1_420px] grid-cols-2 gap-3 sm:grid-cols-3">
          {figures.map((figure) => (
            <FigureTile key={figure.label} figure={figure} />
          ))}
        </div>
      </section>
      {summary.salesCount + summary.returnCount + summary.voidCount === 0 ? (
        <p className="text-text-2">Bu dönemde satış yok.</p>
      ) : (
        <ReportTables summary={summary} />
      )}
    </>
  );
}

/** One headline figure, its label naming the group; the first is drawn large. */
function FigureTile({ figure, hero = false }: { figure: Figure; hero?: boolean }): JSX.Element {
  const labelId = useId();
  return (
    <div
      role="group"
      aria-labelledby={labelId}
      className={`flex flex-col rounded-control border border-line bg-surface ${
        hero ? 'flex-[1_1_260px] justify-center gap-2 p-5' : 'gap-1 p-4'
      }`}
    >
      <span id={labelId} className="text-sm text-text-2">
        {figure.label}
      </span>
      <span
        className={`font-semibold proportional-nums [overflow-wrap:anywhere] ${
          hero ? 'text-4xl md:text-5xl' : 'text-2xl'
        }`}
      >
        {figure.value}
      </span>
      {figure.note ? <span className="text-sm text-muted">{figure.note}</span> : null}
    </div>
  );
}
