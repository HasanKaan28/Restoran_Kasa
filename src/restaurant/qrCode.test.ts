import {
  BinaryBitmap,
  DecodeHintType,
  HybridBinarizer,
  QRCodeReader,
  RGBLuminanceSource,
} from '@zxing/library';
import { describe, expect, it } from 'vitest';
import { qrModules, qrPath, QUIET_ZONE } from './qrCode';

/** Reads a QR code back the way a phone would: from a picture of its modules. */
function decode(modules: boolean[][]): string {
  const scale = 4;
  const side = (modules.length + 2 * QUIET_ZONE) * scale;
  const pixels = new Uint8ClampedArray(side * side).fill(255);
  modules.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (!dark) {
        return;
      }
      for (let dy = 0; dy < scale; dy += 1) {
        for (let dx = 0; dx < scale; dx += 1) {
          pixels[((y + QUIET_ZONE) * scale + dy) * side + (x + QUIET_ZONE) * scale + dx] = 0;
        }
      }
    }),
  );
  const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(pixels, side, side)));
  return new QRCodeReader()
    .decode(bitmap, new Map([[DecodeHintType.PURE_BARCODE, true]]))
    .getText();
}

describe('table card QR codes', () => {
  it('encode the link so a phone reads it back exactly', () => {
    const link =
      'https://restorankasa.vercel.app/app/menu.html?masa=Bah%C3%A7e%2012#Ab3dEf6hIj9kLm2nOp4qRs7tUvWx';
    const modules = qrModules(link);
    expect(modules.length).toBeGreaterThanOrEqual(21);
    expect(modules.every((row) => row.length === modules.length)).toBe(true);
    expect(decode(modules)).toBe(link);
  });

  it('draw every dark module, and only those, inside the quiet zone', () => {
    const modules = [
      [true, true, false],
      [false, true, false],
      [true, false, true],
    ];
    expect(qrPath(modules)).toBe('M4 4h2v1h-2zM5 5h1v1h-1zM4 6h1v1h-1zM6 6h1v1h-1z');
  });
});
