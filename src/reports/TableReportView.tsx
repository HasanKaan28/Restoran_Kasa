import type { JSX } from 'react';
import { formatPeriod } from './reportFormat';

/** The tables of a range of business days: how often each was sat at and what it brought. */
export function TableReportView({ from, to }: { from: string; to: string }): JSX.Element {
  // Placeholder until the table analysis is built (Yönetim paneli plan, Task 3).
  return (
    <>
      <h2 className="text-lg font-semibold">Masalar</h2>
      <p className="text-text-2">{`${formatPeriod(from, to)} · Masa analizi hazırlanıyor.`}</p>
    </>
  );
}
