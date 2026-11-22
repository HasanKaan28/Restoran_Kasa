import type { JSX } from 'react';
import { formatPeriod } from './reportFormat';

/** The lines taken back and made again in a range of business days, and by whom. */
export function VoidReportView({ from, to }: { from: string; to: string }): JSX.Element {
  // Placeholder until the void and remake report is built (Yönetim paneli plan, Task 3).
  return (
    <>
      <h2 className="text-lg font-semibold">İptal / tekrar</h2>
      <p className="text-text-2">{`${formatPeriod(from, to)} · İptal ve tekrar raporu hazırlanıyor.`}</p>
    </>
  );
}
