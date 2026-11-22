import { useLiveQuery } from 'dexie-react-hooks';
import { useState, type JSX } from 'react';
import { useData } from '@/app/appData';
import { ChoiceGroup, SelectField } from '@/design';
import { DailyReportView } from '@/reports/DailyReportView';
import { CustomRangeFields, ReportPeriodPicker } from '@/reports/ReportPeriod';
import { SalesReport, type RegisterChoice } from '@/reports/SalesReport';
import { reportRegisters } from '@/reports/summary';
import { TableReportView } from '@/reports/TableReportView';
import { useReportPeriod } from '@/reports/useReportPeriod';
import { VoidReportView } from '@/reports/VoidReportView';

type ReportKind = 'sales' | 'tables' | 'voids' | 'daily';

const KINDS: readonly { value: ReportKind; label: string }[] = [
  { value: 'sales', label: 'Satışlar' },
  { value: 'tables', label: 'Masalar' },
  { value: 'voids', label: 'İptal / tekrar' },
  { value: 'daily', label: 'Günlük rapor' },
];

/** The register choice that means every register. */
const ALL = '';

/**
 * Yönetim's reports: one period for every view of it, the sales (for one register or all of
 * them), the tables, the voids and remakes, and the days one by one.
 */
export function ReportsSection(): JSX.Element {
  const period = useReportPeriod();
  const [kind, setKind] = useState<ReportKind>('sales');
  const registers = useRegisterOptions();
  const [register, setRegister] = useState(ALL);
  const { from, to } = period;

  return (
    <>
      <ChoiceGroup
        legend="Görünüm"
        name="reportKind"
        options={KINDS}
        value={kind}
        onChange={(next: ReportKind) => setKind(next)}
      />
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-[3_1_440px]">
          <ReportPeriodPicker period={period} />
        </div>
        {kind === 'sales' ? (
          <div className="flex-[1_1_180px]">
            <SelectField
              label="Cihaz"
              options={registers}
              value={register}
              onChange={(event) => setRegister(event.target.value)}
            />
          </div>
        ) : null}
      </div>
      <CustomRangeFields period={period} />
      {kind === 'sales' ? (
        <SalesReport from={from} to={to} register={registerChoice(registers, register)} />
      ) : null}
      {kind === 'tables' ? <TableReportView from={from} to={to} /> : null}
      {kind === 'voids' ? <VoidReportView from={from} to={to} /> : null}
      {kind === 'daily' ? <DailyReportView from={from} to={to} /> : null}
    </>
  );
}

type RegisterOption = { value: string; label: string };

/** Every register that has sold, and this one, by code; "Tümü" first. */
function useRegisterOptions(): readonly RegisterOption[] {
  const { db, settings } = useData();
  const registers = useLiveQuery(() => reportRegisters(db), [db]);
  return [
    { value: ALL, label: 'Tümü' },
    ...[...new Set([...(registers ?? []), settings.deviceCode])].sort().map((code) => ({
      value: code,
      label: code === settings.deviceCode ? `${code} · ${settings.deviceName}` : code,
    })),
  ];
}

function registerChoice(options: readonly RegisterOption[], register: string): RegisterChoice {
  const label = options.find((option) => option.value === register)?.label ?? register;
  return register === ALL ? { label } : { deviceCode: register, label };
}
