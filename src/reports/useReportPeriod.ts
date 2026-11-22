import { useState } from 'react';
import { useMarketSettings } from '@/app/marketSettings';
import { businessDate } from '@/domain/businessDate';
import { periodOf, type PeriodChoice } from './period';

export type PeriodPick = PeriodChoice | 'custom';

/** The business days a report covers, as chosen, and how to choose others. */
export type ReportPeriod = {
  choice: PeriodPick;
  choose(next: PeriodPick): void;
  /** The ends typed for a custom range; either may still be empty. */
  custom: { from: string; to: string };
  setCustom(custom: { from: string; to: string }): void;
  /** Today's business day, the latest a custom range can reach. */
  today: string;
  /** Business days, YYYY-MM-DD, both ends included. */
  from: string;
  to: string;
};

/** A report's period: today to begin with, by the market's business day. */
export function useReportPeriod(): ReportPeriod {
  const [choice, setChoice] = useState<PeriodPick>('today');
  const [custom, setCustom] = useState({ from: '', to: '' });
  const { cutoffMinutes } = useMarketSettings();
  const today = businessDate(new Date(), { cutoffMinutes });
  const { from, to } = choice === 'custom' ? customRange(custom, today) : periodOf(choice, today);

  // A custom range starts from the days on screen, so it only needs the end that changes.
  function choose(next: PeriodPick) {
    if (next === 'custom' && choice !== 'custom') {
      setCustom({ from, to });
    }
    setChoice(next);
  }

  return { choice, choose, custom, setCustom, today, from, to };
}

/** The days a custom range covers; an empty end is today, and ends given backwards are swapped. */
function customRange(custom: { from: string; to: string }, today: string) {
  const from = custom.from || today;
  const to = custom.to || today;
  return from <= to ? { from, to } : { from: to, to: from };
}
