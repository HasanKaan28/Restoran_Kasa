import type { JSX } from 'react';

export type CardColumn = { label: string; numeric?: boolean };
export type CardRow = { key: string; cells: readonly string[]; strong?: boolean };

/**
 * A table on a wide screen and a stack of cards on a phone, from the same markup: below `sm`
 * each cell is its own line, led by its column's label, so nothing scrolls sideways at 375 px.
 */
export function CardTable({
  caption,
  columns,
  rows,
  empty = 'Kayıt yok.',
}: {
  caption: string;
  columns: readonly CardColumn[];
  rows: readonly CardRow[];
  empty?: string;
}): JSX.Element {
  const align = (column: CardColumn | undefined) => (column?.numeric ? 'sm:text-right' : '');
  return (
    <section className="min-w-0 rounded-control border border-line bg-surface p-4">
      <table className="block w-full border-collapse text-left sm:table">
        <caption className="mb-2 block text-left text-base font-semibold sm:table-caption">
          {caption}
        </caption>
        <thead className="sr-only sm:not-sr-only sm:table-header-group">
          <tr className="border-b border-line-strong text-sm text-text-2 sm:table-row">
            {columns.map((column) => (
              <th
                key={column.label}
                scope="col"
                className={`py-2 pr-3 font-medium ${align(column)}`}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="block sm:table-row-group">
          {rows.length === 0 ? (
            <tr className="block sm:table-row">
              <td colSpan={columns.length} className="block py-3 text-muted sm:table-cell">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr
                key={row.key}
                className={`mb-2 block rounded-control border border-line p-3 last:mb-0 sm:mb-0 sm:table-row sm:rounded-none sm:border-0 sm:border-b sm:border-line sm:p-0 sm:last:border-0 ${
                  row.strong ? 'font-semibold' : ''
                }`}
              >
                {row.cells.map((cell, index) => (
                  <td
                    key={columns[index]?.label ?? index}
                    data-label={columns[index]?.label}
                    className={`flex min-w-0 justify-between gap-3 break-words py-1 before:shrink-0 before:text-sm before:font-normal before:text-text-2 before:content-[attr(data-label)] sm:table-cell sm:py-2 sm:pr-3 sm:before:content-none ${align(columns[index])}`}
                  >
                    <span className="min-w-0 text-right sm:text-inherit">{cell}</span>
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </section>
  );
}
