import { strFromU8, unzipSync } from 'fflate';

const RELATIONSHIPS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const MB = 1024 * 1024;
/**
 * The most one part, and all the parts read together, may unpack to. A product list of tens of
 * thousands of rows is a few megabytes; a zip bomb (a small file unpacking to gigabytes) is
 * refused before anything is unpacked, by the sizes the zip declares (fflate unpacks a part
 * into a buffer of its declared size, never more).
 */
const MAX_PART_BYTES = 32 * MB;
const MAX_TOTAL_BYTES = 64 * MB;
/** More rows than any menu or product list has. */
const MAX_ROWS = 50_000;

/** The file is not an Excel workbook, or it has no sheet to read. */
export class XlsxReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'XlsxReadError';
  }
}

/**
 * The cells of a workbook's first sheet as text, row by row. Shared, inline and formula strings
 * are read as text, numbers with a decimal comma ("12,5"); a missing cell is "" so every value
 * stays in its column. Rows with nothing in them are dropped, as `parseCsv` drops blank lines.
 */
export function readXlsx(
  bytes: Uint8Array,
  { maxRows = MAX_ROWS }: { maxRows?: number } = {},
): string[][] {
  let files: Record<string, Uint8Array>;
  let total = 0;
  let tooLarge = false;
  try {
    files = unzipSync(bytes, {
      filter: (file) => {
        if (!file.name.startsWith('xl/') || tooLarge) {
          return false;
        }
        total += file.originalSize;
        tooLarge = file.originalSize > MAX_PART_BYTES || total > MAX_TOTAL_BYTES;
        return !tooLarge;
      },
    });
  } catch {
    throw new XlsxReadError('Not a zip file');
  }
  if (tooLarge) {
    throw new XlsxReadError('The workbook is too large');
  }
  const sheet = readXml(files, firstSheetPath(files));
  const sharedStrings = files['xl/sharedStrings.xml']
    ? elements(readXml(files, 'xl/sharedStrings.xml'), 'si').map(richText)
    : [];
  const sheetRows = elements(sheet, 'row');
  if (sheetRows.length > maxRows) {
    throw new XlsxReadError(`The sheet has too many rows (${sheetRows.length})`);
  }
  const rows: string[][] = [];
  for (const row of sheetRows) {
    const cells: string[] = [];
    for (const cell of elements(row, 'c')) {
      const column = columnIndex(cell.getAttribute('r')) ?? cells.length;
      while (cells.length < column) {
        cells.push('');
      }
      cells[column] = cellText(cell, sharedStrings);
    }
    if (cells.some((cell) => cell.trim() !== '')) {
      rows.push(cells);
    }
  }
  return rows;
}

/** The path of the first sheet the workbook lists, through the workbook's relationships. */
function firstSheetPath(files: Record<string, Uint8Array>): string {
  const sheet = elements(readXml(files, 'xl/workbook.xml'), 'sheet')[0];
  const id = sheet?.getAttributeNS(RELATIONSHIPS, 'id');
  const target = elements(readXml(files, 'xl/_rels/workbook.xml.rels'), 'Relationship')
    .find((relationship) => relationship.getAttribute('Id') === id)
    ?.getAttribute('Target');
  if (!target) {
    throw new XlsxReadError('The workbook has no sheet');
  }
  return target.startsWith('/') ? target.slice(1) : `xl/${target}`;
}

function readXml(files: Record<string, Uint8Array>, path: string): Document {
  const bytes = files[path];
  if (!bytes) {
    throw new XlsxReadError(`Missing part: ${path}`);
  }
  const document = new DOMParser().parseFromString(strFromU8(bytes), 'application/xml');
  if (document.getElementsByTagName('parsererror').length > 0) {
    throw new XlsxReadError(`Unreadable part: ${path}`);
  }
  return document;
}

/** Descendants by local name, whatever prefix the producer gave the namespace. */
function elements(root: Document | Element, localName: string): Element[] {
  return Array.from(root.getElementsByTagNameNS('*', localName));
}

function cellText(cell: Element, sharedStrings: readonly string[]): string {
  const value = elements(cell, 'v')[0]?.textContent ?? '';
  switch (cell.getAttribute('t')) {
    case 's':
      return sharedStrings[Number(value)] ?? '';
    case 'inlineStr':
      return richText(elements(cell, 'is')[0]);
    case 'b':
      return value === '1' ? 'TRUE' : 'FALSE';
    case null:
    case 'n':
      return numberText(value);
    default:
      return value;
  }
}

/**
 * A number cell as it would be typed here: a decimal comma and no grouping ("4,875"), so a
 * text reader never takes "4.875" for four thousand. Fifteen significant digits, as Excel shows,
 * drop the noise of binary fractions ("5.3950000000000005" → "5,395").
 */
function numberText(value: string): string {
  const number = Number(value);
  if (value.trim() === '' || !Number.isFinite(number)) {
    return value;
  }
  const clean = Number(number.toPrecision(15));
  return Number.isInteger(clean) ? String(clean) : String(clean).replace('.', ',');
}

/** The text of a string item: its runs joined, without the phonetic guides some files carry. */
function richText(item: Element | undefined): string {
  if (!item) {
    return '';
  }
  return elements(item, 't')
    .filter((text) => text.parentElement?.localName !== 'rPh')
    .map((text) => text.textContent ?? '')
    .join('');
}

/** "C12" → 2. */
function columnIndex(reference: string | null): number | undefined {
  const letters = reference?.match(/^[A-Z]+/)?.[0];
  if (!letters) {
    return undefined;
  }
  let index = 0;
  for (const letter of letters) {
    index = index * 26 + (letter.charCodeAt(0) - 64);
  }
  return index - 1;
}
