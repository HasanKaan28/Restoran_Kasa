import type { JSX } from 'react';
import { formatPeriod } from './reportFormat';

/** The business days of a range one by one. */
export function DailyReportView({ from, to }: { from: string; to: string }): JSX.Element {
  // Placeholder until the daily report is built.
  return (
    <>
      <h2 className="text-lg font-semibold">Günlük rapor</h2>
      <p className="text-text-2">{`${formatPeriod(from, to)} · Günlük rapor hazırlanıyor.`}</p>
    </>
  );
}
