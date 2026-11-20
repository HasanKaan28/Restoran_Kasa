/** A table's name as people say it: "3" alone reads as a count, "Masa 3" is how it is said. */
export function tableTitle(name: string): string {
  return /^\d+$/.test(name) ? `Masa ${name}` : name;
}
