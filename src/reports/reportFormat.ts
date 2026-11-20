import { formatTRY, type Kurus } from '@/domain/money';
import type { Summary } from './summary';

/** One headline figure: a label, its value and, where it helps, a line under it. */
export type Figure = { label: string; value: string; note?: string };

export const percentFormat = new Intl.NumberFormat('tr-TR', {
  style: 'percent',
  maximumFractionDigits: 1,
});

/** An amount that can fall below zero, with a real minus sign: "−₺12,50". */
export function formatAmount(amount: Kurus): string {
  return amount < 0 ? `−${formatTRY(-amount)}` : formatTRY(amount);
}

/** "29.10.2026", or "26.10.2026 – 29.10.2026" for more than one business day. */
export function formatPeriod(from: string, to: string): string {
  const day = (iso: string) => iso.split('-').reverse().join('.');
  return from === to ? day(from) : `${day(from)} – ${day(to)}`;
}

/**
 * The headline figures of a report, net sales first, then in rows of three: the sales, how they
 * were paid, and what came off them. Without `cost`, gross profit is left out (DESIGN §8.5).
 * Credit sales and returns are the market's: the restaurant has neither, so their figures show
 * only when there is something in them. With no buy price entered, a gross profit would be the
 * whole of the sales, so it says so instead.
 */
export function reportFigures(
  summary: Summary,
  { cost = true }: { cost?: boolean } = {},
): Figure[] {
  const costKnown = summary.cost !== 0 || summary.net === 0;
  const margin =
    costKnown && summary.net > 0 ? percentFormat.format(summary.grossProfit / summary.net) : null;
  const returned = summary.returnCount > 0 || summary.returnTotal !== 0;
  const figures: Figure[] = [
    {
      label: 'Net satış',
      value: formatAmount(summary.net),
      ...(returned ? { note: `İade öncesi satış ${formatAmount(summary.gross)}` } : {}),
    },
    { label: 'İşlem', value: String(summary.salesCount) },
    { label: 'Ortalama hesap', value: formatAmount(summary.averageBasket) },
    costKnown
      ? {
          label: 'Brüt kâr',
          value: formatAmount(summary.grossProfit),
          ...(margin ? { note: `Kâr oranı ${margin}` } : {}),
        }
      : { label: 'Brüt kâr', value: '—', note: 'Alış fiyatı girilmemiş' },
    { label: 'Nakit', value: formatAmount(summary.byMethod.cash) },
    { label: 'Kart', value: formatAmount(summary.byMethod.card) },
    ...(summary.byMethod.credit !== 0
      ? [{ label: 'Veresiye', value: formatAmount(summary.byMethod.credit) }]
      : []),
    { label: 'İndirim', value: formatAmount(summary.discounts) },
    ...(returned
      ? [
          {
            label: 'İade',
            value: formatAmount(summary.returnTotal),
            note: `${summary.returnCount} iade`,
          },
        ]
      : []),
    { label: 'İptal', value: formatAmount(summary.voidTotal), note: `${summary.voidCount} fiş` },
  ];
  return cost ? figures : figures.filter((figure) => figure.label !== 'Brüt kâr');
}
