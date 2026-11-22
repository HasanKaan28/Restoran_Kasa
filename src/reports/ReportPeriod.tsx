import type { JSX } from 'react';
import { ChoiceGroup, TextField } from '@/design';
import type { PeriodPick, ReportPeriod } from './useReportPeriod';

const PERIODS: readonly { value: PeriodPick; label: string }[] = [
  { value: 'today', label: 'Bugün' },
  { value: 'yesterday', label: 'Dün' },
  { value: 'week', label: 'Bu hafta' },
  { value: 'month', label: 'Bu ay' },
  { value: 'custom', label: 'Özel' },
];

export function ReportPeriodPicker({ period }: { period: ReportPeriod }): JSX.Element {
  return (
    <ChoiceGroup
      legend="Dönem"
      name="reportPeriod"
      options={PERIODS}
      value={period.choice}
      onChange={period.choose}
    />
  );
}

/** The two ends of a custom range, shown only while one is chosen. */
export function CustomRangeFields({ period }: { period: ReportPeriod }): JSX.Element | null {
  if (period.choice !== 'custom') {
    return null;
  }
  const { custom, setCustom, today } = period;
  return (
    <div className="flex flex-wrap gap-3">
      <TextField
        label="Başlangıç"
        type="date"
        max={today}
        value={custom.from}
        onChange={(event) => setCustom({ ...custom, from: event.target.value })}
      />
      <TextField
        label="Bitiş"
        type="date"
        max={today}
        value={custom.to}
        onChange={(event) => setCustom({ ...custom, to: event.target.value })}
      />
    </div>
  );
}
