import { encode } from 'uqr';

/** The white margin a reader needs around the code, in modules (ISO/IEC 18004). */
export const QUIET_ZONE = 4;

/**
 * The modules of a QR code for `text`, made on the device (no QR service ever sees the link).
 * Medium error correction: a card with a stain or a fold still reads.
 */
export function qrModules(text: string): boolean[][] {
  return encode(text, { ecc: 'M', border: 0 }).data;
}

/** One SVG path for every dark module: each run of dark modules in a row is one rectangle. */
export function qrPath(
  modules: readonly (readonly boolean[])[],
  quiet: number = QUIET_ZONE,
): string {
  let path = '';
  modules.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (!row[x]) {
        x += 1;
        continue;
      }
      const start = x;
      while (x < row.length && row[x]) {
        x += 1;
      }
      const width = x - start;
      path += `M${start + quiet} ${y + quiet}h${width}v1h-${width}z`;
    }
  });
  return path;
}
