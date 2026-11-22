import { useLiveQuery } from 'dexie-react-hooks';
import { Archive, Download, Printer, Save } from 'lucide-react';
import { useState, type JSX } from 'react';
import { useData } from '@/app/appData';
import { useSession } from '@/app/session';
import { archiveSavedReport, listSavedReports, saveReport } from '@/data/savedReports';
import type { CashSessionRecord, SavedReportRecord } from '@/data/types';
import { Button, Dialog, SelectField, TextField, ToastRegion, useToast } from '@/design';
import { formatTRY } from '@/domain/money';
import { loadReceiptSettings } from '@/pos/receiptSettings';
import { printZReport } from '@/pos/printZReport';
import { formatDifference, zReportModel } from '@/pos/zReport';
import { ZReportView } from '@/pos/ZReportView';
import { downloadText } from '@/products/exportCsv';
import { CustomRangeFields, ReportPeriodPicker } from '@/reports/ReportPeriod';
import { printReport } from '@/reports/printReport';
import { soldProductsCsv } from '@/reports/reportCsv';
import { formatPeriod } from '@/reports/reportFormat';
import { ReportSummary } from '@/reports/SalesReport';
import { loadSummary, reportRegisters } from '@/reports/summary';
import { useReportPeriod } from '@/reports/useReportPeriod';
import { periodText, readableReport, stampText } from './savedReportView';

/** The register choice that means every register. */
const ALL = '';
/** How many day-end records show before "Daha eski kayıtlar". */
const FIRST_PAGE = 30;

/**
 * Yönetim's archive: the day-end (Z) records of the registers, and the reports saved from a
 * period, kept as the figures they had when saved.
 */
export function ArchiveSection(): JSX.Element {
  return (
    <>
      <DayEndRecords />
      <SavePeriod />
      <SavedReports />
    </>
  );
}

function DayEndRecords(): JSX.Element {
  const { db, settings } = useData();
  const [open, setOpen] = useState<CashSessionRecord | null>(null);
  const [limit, setLimit] = useState(FIRST_PAGE);
  const records = useLiveQuery(
    async () =>
      (await db.cashSessions.toArray()).sort((a, b) => b.closedAt.localeCompare(a.closedAt)),
    [db],
  );
  const names = useStaffNames();

  return (
    <section aria-label="Gün sonu kayıtları" className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Gün sonu kayıtları</h2>
      {records === undefined ? (
        <p className="text-text-2">Yükleniyor…</p>
      ) : records.length === 0 ? (
        <p className="text-text-2">Henüz gün sonu kaydı yok.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {records.slice(0, limit).map((record) => (
            <li
              key={record.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-control border border-line bg-surface p-3"
            >
              <div className="min-w-0 flex-[1_1_160px]">
                <p className="font-medium">
                  {formatPeriod(record.businessDate, record.businessDate)}
                </p>
                <p className="text-sm text-text-2 [overflow-wrap:anywhere]">
                  {[record.deviceCode, record.staffId ? names.get(record.staffId) : undefined]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
              <dl className="grid flex-[2_1_260px] grid-cols-3 gap-2 text-sm">
                <Money label="Beklenen" value={formatTRY(record.expectedCash)} />
                <Money label="Sayılan" value={formatTRY(record.countedCash)} />
                <Money label="Fark" value={formatDifference(record.difference)} />
              </dl>
              <Button
                onClick={() => setOpen(record)}
              >{`Z raporunu aç, ${record.businessDate}`}</Button>
            </li>
          ))}
        </ul>
      )}
      {records && records.length > limit ? (
        <Button onClick={() => setLimit(limit + FIRST_PAGE)}>Daha eski kayıtlar</Button>
      ) : null}
      {open ? (
        <ZDialog
          record={open}
          marketName={settings.marketName}
          deviceName={
            open.deviceCode === settings.deviceCode ? settings.deviceName : open.deviceCode
          }
          onClose={() => setOpen(null)}
        />
      ) : null}
    </section>
  );
}

function Money({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="min-w-0">
      <dt className="text-text-2">{label}</dt>
      <dd className="font-medium proportional-nums [overflow-wrap:anywhere]">{value}</dd>
    </div>
  );
}

function ZDialog({
  record,
  marketName,
  deviceName,
  onClose,
}: {
  record: CashSessionRecord;
  marketName: string;
  deviceName: string;
  onClose: () => void;
}): JSX.Element {
  const paperWidth = loadReceiptSettings().paperWidth;
  const model = zReportModel(record, { marketName, deviceName });
  return (
    <Dialog
      open
      onOpenChange={(next) => !next && onClose()}
      title="Z raporu"
      footer={
        <Button
          icon={<Printer aria-hidden="true" size={18} />}
          onClick={() => printZReport(model, paperWidth)}
        >
          Yazdır
        </Button>
      }
    >
      <div className="overflow-x-auto">
        <ZReportView model={model} paperWidth={paperWidth} />
      </div>
    </Dialog>
  );
}

/** The period to keep, under a title: its figures are computed now and stored as they are. */
function SavePeriod(): JSX.Element {
  const { db, settings, runner } = useData();
  const { staff } = useSession();
  const period = useReportPeriod();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [register, setRegister] = useState(ALL);
  const [busy, setBusy] = useState(false);
  const registers = useLiveQuery(() => reportRegisters(db), [db]);
  const options = [
    { value: ALL, label: 'Tümü' },
    ...[...new Set([...(registers ?? []), settings.deviceCode])].sort().map((code) => ({
      value: code,
      label: code,
    })),
  ];
  const { from, to } = period;

  async function save() {
    setBusy(true);
    try {
      const summary = await loadSummary(db, {
        from,
        to,
        ...(register === ALL ? {} : { deviceCode: register }),
      });
      await saveReport(
        db,
        {
          title: title.trim() || `Satış raporu · ${formatPeriod(from, to)}`,
          from,
          to,
          ...(register === ALL ? {} : { register }),
          summary,
          deviceCode: settings.deviceCode,
          ...(staff ? { staffId: staff.id } : {}),
        },
        new Date(),
      );
      setTitle('');
      toast.show('Rapor kaydedildi');
      void runner.run();
    } catch {
      toast.show('Rapor kaydedilemedi');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Dönemi kaydet" className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Dönemi kaydet</h2>
      <ReportPeriodPicker period={period} />
      <CustomRangeFields period={period} />
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-[2_1_220px]">
          <TextField
            label="Başlık"
            value={title}
            placeholder={`Satış raporu · ${formatPeriod(from, to)}`}
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>
        <div className="flex-[1_1_160px]">
          <SelectField
            label="Cihaz"
            options={options}
            value={register}
            onChange={(event) => setRegister(event.target.value)}
          />
        </div>
        <Button
          variant="primary"
          icon={<Save aria-hidden="true" size={18} />}
          disabled={busy}
          onClick={() => void save()}
        >
          Kaydet
        </Button>
      </div>
      <ToastRegion message={toast.message} />
    </section>
  );
}

function SavedReports(): JSX.Element {
  const { db, runner } = useData();
  const reports = useLiveQuery(async () => (await listSavedReports(db)).map(readableReport), [db]);
  const [open, setOpen] = useState<SavedReportRecord | null>(null);

  async function archive(report: SavedReportRecord) {
    await archiveSavedReport(db, report.id, new Date());
    void runner.run();
  }

  return (
    <section aria-label="Kaydedilen raporlar" className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Kaydedilen raporlar</h2>
      {reports === undefined ? (
        <p className="text-text-2">Yükleniyor…</p>
      ) : reports.length === 0 ? (
        <p className="text-text-2">Henüz kaydedilmiş rapor yok.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {reports.map((report) => (
            <li
              key={report.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-control border border-line bg-surface p-3"
            >
              <div className="min-w-0 flex-[1_1_200px]">
                <p className="font-medium [overflow-wrap:anywhere]">{report.title}</p>
                <p className="text-sm text-text-2 [overflow-wrap:anywhere]">
                  {`${periodText(report.from, report.to)} · ${report.register ?? 'Tümü'} · ${stampText(report.createdAt)}`}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => setOpen(report)}>{`Aç, ${report.title}`}</Button>
                <Button
                  icon={<Archive aria-hidden="true" size={18} />}
                  onClick={() => void archive(report)}
                >
                  {`Arşivle, ${report.title}`}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {open ? <SavedReportDialog report={open} onClose={() => setOpen(null)} /> : null}
    </section>
  );
}

/** A saved report as stored: the same figures and tables, nothing recomputed. */
function SavedReportDialog({
  report,
  onClose,
}: {
  report: SavedReportRecord;
  onClose: () => void;
}): JSX.Element {
  const { settings } = useData();
  const session = useSession();
  const seeCost = session.can('seeCost');

  function print() {
    printReport({
      marketName: settings.marketName,
      from: report.from,
      to: report.to,
      register: report.register ?? 'Tümü',
      summary: report.summary,
      showCost: seeCost,
      printedAt: new Date(),
    });
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => !next && onClose()}
      title={report.title}
      description={`${periodText(report.from, report.to)} · ${report.register ?? 'Tümü'}`}
      size="lg"
      footer={
        <>
          {session.can('admin') ? (
            <Button
              icon={<Download aria-hidden="true" size={18} />}
              onClick={() =>
                downloadText(
                  `satislar-${report.from}-${report.to}.csv`,
                  soldProductsCsv(report.summary),
                )
              }
            >
              CSV indir
            </Button>
          ) : null}
          <Button icon={<Printer aria-hidden="true" size={18} />} onClick={print}>
            Yazdır
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <ReportSummary summary={report.summary} seeCost={seeCost} />
      </div>
    </Dialog>
  );
}

/** Staff by id, for naming who closed a day. */
function useStaffNames(): Map<string, string> {
  const { db } = useData();
  const people = useLiveQuery(() => db.staff.toArray(), [db]);
  return new Map((people ?? []).map((person) => [person.id, person.name]));
}
