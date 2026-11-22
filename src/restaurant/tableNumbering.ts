type NumberedTable = { name: string; area: string; archivedAt?: string };

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const sameArea = (a: string, b: string): boolean =>
  (a.trim() || 'Salon').toLocaleLowerCase('tr') === (b.trim() || 'Salon').toLocaleLowerCase('tr');

/**
 * The number a new table of `area` would get: one past the largest number among the area's own
 * tables, 1 when it has none. Numbers are read from names like "5", "Salon 5" or, when a prefix
 * is typed, "B5"; any other name is skipped. Archived tables do not count, so a number freed by
 * removing the last table is offered again.
 */
export function nextTableNumber(
  tables: readonly NumberedTable[],
  area: string,
  prefix = '',
): number {
  const lead = prefix.trim();
  const pattern = new RegExp(
    lead ? `^${escape(lead)}(\\d+)$` : `^(?:${escape(area.trim() || 'Salon')} )?(\\d+)$`,
    'iu',
  );
  let highest = 0;
  for (const table of tables) {
    if (table.archivedAt || !sameArea(table.area, area)) {
      continue;
    }
    const digits = pattern.exec(table.name.trim())?.[1];
    if (digits) {
      highest = Math.max(highest, Number(digits));
    }
  }
  return highest + 1;
}

/** The "İlk no" and "Son no" to offer: 1 to 10 on an empty restaurant, else one table onward. */
export function suggestedRun(
  tables: readonly NumberedTable[],
  area: string,
  prefix = '',
): { from: number; to: number } {
  const from = nextTableNumber(tables, area, prefix);
  const empty = tables.every((table) => table.archivedAt);
  return { from, to: empty ? from + 9 : from };
}
