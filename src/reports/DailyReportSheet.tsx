import type { JSX } from 'react';
import { formatStock } from '@/pos/format';
import type { DailyReport } from './dailyReport';
import { formatAmount, formatPeriod } from './reportFormat';

export type DailyReportModel = {
  marketName: string;
  report: DailyReport;
  printedAt: Date;
};

const printedFormat = new Intl.DateTimeFormat('tr-TR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'Europe/Istanbul',
});

/** The report as one clean page: products by category, totals, payments, treats and voids. */
export function DailyReportSheet({ model }: { model: DailyReportModel }): JSX.Element {
  const { report } = model;
  const empty = report.categories.length === 0 && report.complimentary.count === 0;
  return (
    <article aria-label="Günlük rapor" className="flex flex-col gap-4 text-[11pt]">
      <header className="flex flex-col gap-1">
        <p className="text-[14pt] font-semibold [overflow-wrap:anywhere]">{model.marketName}</p>
        <h1 className="text-[16pt] font-semibold">Günlük rapor</h1>
        <p>{`Dönem: ${formatPeriod(report.from, report.to)}`}</p>
        <p>{`Yazdırıldı: ${printedFormat.format(model.printedAt)}`}</p>
      </header>
      {empty ? <p>Bu dönemde satış yok.</p> : null}
      {report.categories.map((group) => (
        <table key={group.categoryId ?? ''} className="w-full border-collapse text-left">
          <caption className="mb-1 text-left text-[12pt] font-semibold">{group.name}</caption>
          <thead>
            <tr className="border-b border-line-strong text-[10pt]">
              <th scope="col" className="py-1 pr-2 font-medium">
                Ürün
              </th>
              <th scope="col" className="px-2 py-1 text-right font-medium">
                Miktar
              </th>
              <th scope="col" className="py-1 pl-2 text-right font-medium">
                Tutar
              </th>
            </tr>
          </thead>
          <tbody>
            {group.rows.map((row) => (
              <tr key={row.productId} className="border-b border-line">
                <td className="py-1 pr-2 [overflow-wrap:anywhere]">{row.name}</td>
                <td className="whitespace-nowrap px-2 py-1 text-right">
                  {formatStock(row.qtyMilli, row.unit ?? 'piece')}
                </td>
                <td className="whitespace-nowrap py-1 pl-2 text-right">{formatAmount(row.net)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <th scope="row" colSpan={2} className="py-1 pr-2 text-left">
                {`${group.name} ara toplam`}
              </th>
              <td className="whitespace-nowrap py-1 pl-2 text-right">{formatAmount(group.net)}</td>
            </tr>
          </tfoot>
        </table>
      ))}
      <dl className="flex flex-col border-t-2 border-text">
        <Line label="Genel toplam" value={formatAmount(report.total)} strong />
        <Line label="Nakit" value={formatAmount(report.byMethod.cash)} />
        <Line label="Kart" value={formatAmount(report.byMethod.card)} />
        {report.byMethod.credit !== 0 ? (
          <Line label="Veresiye" value={formatAmount(report.byMethod.credit)} />
        ) : null}
        <Line label="Fiş sayısı" value={String(report.salesCount)} />
        <Line
          label="İkram"
          value={formatAmount(report.complimentary.value)}
          note={`${report.complimentary.count} kalem, menü fiyatıyla`}
        />
        <Line
          label="İptal"
          value={formatAmount(report.voidTotal)}
          note={`${report.voidCount} fiş, genel toplama dahil değil`}
        />
        {report.earlierVoidCount > 0 ? (
          <Line
            label="Önceki günlerin iptali"
            value={formatAmount(report.earlierVoidTotal)}
            note={`${report.earlierVoidCount} fiş, genel toplamdan düşüldü`}
          />
        ) : null}
        {report.returnCount > 0 ? (
          <Line
            label="İade"
            value={formatAmount(report.returnTotal)}
            note={`${report.returnCount} iade, genel toplamdan düşüldü`}
          />
        ) : null}
      </dl>
      {report.complimentary.count > 0 ? (
        <p className="text-[10pt]">
          İkram toplama dahil değildir. Tamamı indirimli (%100) satırlar da ikram sayılır.
        </p>
      ) : null}
      {report.complimentary.rows.length > 0 ? (
        <table className="w-full border-collapse text-left">
          <caption className="mb-1 text-left text-[12pt] font-semibold">İkram edilenler</caption>
          <tbody>
            {report.complimentary.rows.map((row) => (
              <tr key={row.productId} className="border-b border-line">
                <td className="py-1 pr-2 [overflow-wrap:anywhere]">{row.name}</td>
                <td className="whitespace-nowrap px-2 py-1 text-right">
                  {formatStock(row.qtyMilli, row.unit ?? 'piece')}
                </td>
                <td className="whitespace-nowrap py-1 pl-2 text-right">
                  {formatAmount(row.value)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </article>
  );
}

function Line({
  label,
  value,
  note,
  strong = false,
}: {
  label: string;
  value: string;
  note?: string;
  strong?: boolean;
}): JSX.Element {
  return (
    <div
      className={`flex flex-wrap justify-between gap-x-4 border-b border-line py-1 ${
        strong ? 'text-[13pt] font-semibold' : ''
      }`}
    >
      <dt>{note ? `${label} (${note})` : label}</dt>
      <dd className="text-right font-semibold">{value}</dd>
    </div>
  );
}
