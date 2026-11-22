import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Files that may name a colour outright. Everything else takes its colours from tokens.css, so
 * that it follows the light and the dark theme.
 */
const ALLOWED: Record<string, string> = {
  'src/design/tokens.css': 'the colours themselves',
  // Paper is black on white whatever the screen shows.
  'src/pos/ReceiptView.tsx': 'a receipt, printed and previewed as paper',
  'src/pos/ZReportView.tsx': 'the day-end report, printed',
  'src/customers/StatementView.tsx': 'a customer statement, printed',
  'src/reports/ReportView.tsx': 'a sales report, printed',
  'src/labels/LabelSheet.tsx': 'shelf labels and barcodes, printed',
  'src/restaurant/TableCards.tsx': 'table cards with the QR menu code, printed',
  'src/restaurant/OrderSlipView.tsx': 'the order slip, printed as each order comes in',
  // The brand mark keeps its own colours in both themes, as public/logo.svg does.
  'src/updates/UpdateMark.tsx': 'the mark printing itself, in branding/mark.svg’s colours',
  'src/updates/updates.css': 'the mark’s tile, its printer slot and light',
};

const TAILWIND_PALETTE =
  'white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';

const RULES: [name: string, pattern: RegExp][] = [
  ['hex colour', /(?<![\w&/])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b(?![\w-])/i],
  ['colour function', /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/],
  [
    'Tailwind palette colour',
    new RegExp(
      `\\b(?:bg|text|border(?:-[trblxy])?|ring|ring-offset|outline|fill|stroke|divide|shadow|from|via|to|decoration|caret|accent|placeholder)-(?:${TAILWIND_PALETTE})(?:-\\d{2,3})?\\b`,
    ),
  ],
  ['arbitrary colour value', /-\[(?:#|rgb|hsl|color:)/],
  [
    'named colour in a style',
    /\b(?:color|background|backgroundColor|borderColor|fill|stroke)\s*:\s*['"](?!var\(|transparent|currentColor|inherit|none)[a-z]+['"]/i,
  ],
];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name).replaceAll('\\', '/');
    if (statSync(path).isDirectory()) {
      return sources(path);
    }
    return /\.(ts|tsx|css)$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

describe('colours', () => {
  it('come from the theme tokens everywhere but on paper', () => {
    const found = sources('src')
      .filter((path) => !(path in ALLOWED))
      .flatMap((path) =>
        readFileSync(path, 'utf8')
          .split('\n')
          .flatMap((line, index) =>
            RULES.filter(([, pattern]) => pattern.test(line)).map(
              ([rule]) => `${path}:${index + 1} ${rule}: ${line.trim()}`,
            ),
          ),
      );
    expect(found).toEqual([]);
  });

  it('allow only files that exist', () => {
    const all = new Set(sources('src'));
    expect(Object.keys(ALLOWED).filter((path) => !all.has(path))).toEqual([]);
  });
});
