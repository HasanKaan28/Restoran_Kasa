import type { SavedReportRecord } from '@/data/types';
import { formatPeriod } from '@/reports/reportFormat';
import type { Summary } from '@/reports/summary';

/** A summary with nothing in it: what a pulled report's missing figures are read as. */
const EMPTY_SUMMARY: Summary = {
  salesCount: 0,
  voidCount: 0,
  voidTotal: 0,
  earlierVoidCount: 0,
  earlierVoidTotal: 0,
  returnCount: 0,
  returnTotal: 0,
  gross: 0,
  discounts: 0,
  net: 0,
  byMethod: { cash: 0, card: 0, credit: 0 },
  vatByRate: [],
  cost: 0,
  grossProfit: 0,
  averageBasket: 0,
  categories: [],
  productsSold: [],
  bestSellers: [],
  byDevice: [],
  byStaff: [],
};

const STAMP = new Intl.DateTimeFormat('tr-TR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Istanbul',
});

const UNKNOWN = '—';

/**
 * A summary read from a stored or pulled row: every list and figure it lacks, or holds in the
 * wrong shape, is an empty one, so the report tables never meet an undefined.
 */
export function readableSummary(raw: unknown): Summary {
  const source = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const result: Record<string, unknown> = { ...EMPTY_SUMMARY };
  for (const [key, empty] of Object.entries(EMPTY_SUMMARY)) {
    const value = source[key];
    if (Array.isArray(empty)) {
      result[key] = Array.isArray(value) ? value : empty;
    } else if (typeof empty === 'number') {
      result[key] = typeof value === 'number' && Number.isFinite(value) ? value : empty;
    }
  }
  const byMethod = source.byMethod as Record<string, unknown> | undefined;
  result.byMethod = Object.fromEntries(
    (['cash', 'card', 'credit'] as const).map((method) => {
      const value = byMethod?.[method];
      return [method, typeof value === 'number' && Number.isFinite(value) ? value : 0];
    }),
  );
  return result as Summary;
}

/** A saved report whose text fields are strings and whose summary is whole, whatever was pulled. */
export function readableReport(report: SavedReportRecord): SavedReportRecord {
  const text = (value: unknown, fallback: string) =>
    typeof value === 'string' && value ? value : fallback;
  return {
    ...report,
    title: text(report.title, 'Adsız rapor'),
    from: text(report.from, ''),
    to: text(report.to, ''),
    ...(typeof report.register === 'string' && report.register ? {} : { register: undefined }),
    summary: readableSummary(report.summary),
  };
}

/** "01.10.2026 – 02.10.2026", or a dash when an end is missing. */
export function periodText(from: string, to: string): string {
  return from && to ? formatPeriod(from, to) : UNKNOWN;
}

/** The date and time a report was saved, or a dash when the stamp is unusable. */
export function stampText(createdAt: unknown): string {
  const date = typeof createdAt === 'string' ? new Date(createdAt) : null;
  return date && !Number.isNaN(date.getTime()) ? STAMP.format(date) : UNKNOWN;
}
