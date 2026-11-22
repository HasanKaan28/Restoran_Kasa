/** A table's name as people say it: "3" alone reads as a count, "Masa 3" is how it is said. */
export function tableTitle(name: string): string {
  return /^\d+$/.test(name) ? `Masa ${name}` : name;
}

type LabelledTable = { id: string; name: string; area: string; archivedAt?: string };

const sameName = (a: string, b: string): boolean =>
  a.trim().toLocaleLowerCase('tr') === b.trim().toLocaleLowerCase('tr');

/**
 * A table's label on screen and on a QR card: its plain name while no other active table has it,
 * else "<area> <name>" ("Dışarı 1"), since each area numbers its tables from 1.
 */
export function tableLabelIn(table: LabelledTable, tables: readonly LabelledTable[]): string {
  const shared = tables.some(
    (other) => other.id !== table.id && !other.archivedAt && sameName(other.name, table.name),
  );
  return shared ? `${table.area.trim() || 'Salon'} ${table.name.trim()}` : table.name;
}
