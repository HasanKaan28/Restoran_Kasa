import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/design/tokens.css', 'utf8');

/** The `--color-*` declarations of the first block that follows `selector`. */
function colours(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  expect(start, `${selector} is missing from tokens.css`).toBeGreaterThanOrEqual(0);
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  return Object.fromEntries(
    [...body.matchAll(/--color-([\w-]+):\s*([^;]+);/g)].map((match) => [match[1], match[2]]),
  );
}

const light = colours('@theme');
const dark = colours(":root[data-theme='dark']");

function luminance(hex: string): number {
  const value = Number.parseInt(hex.slice(1), 16);
  const channels = [value >> 16, (value >> 8) & 255, value & 255].map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high! + 0.05) / (low! + 0.05);
}

/** `color` laid over `under` at `alpha`, as `bg-accent/10` paints it. */
function over(color: string, under: string, alpha: number): string {
  const channel = (hex: string, shift: number) =>
    (Number.parseInt(hex.slice(1), 16) >> shift) & 255;
  return `#${[16, 8, 0]
    .map((shift) =>
      Math.round(channel(color, shift) * alpha + channel(under, shift) * (1 - alpha))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

// Text colour, the surface it is read on, and the least contrast it needs (WCAG AA).
const PAIRS: [text: string, surface: string][] = [
  ['text', 'bg'],
  ['text', 'surface'],
  ['text-2', 'bg'],
  ['text-2', 'surface'],
  ['muted', 'bg'],
  ['muted', 'surface'],
  ['accent', 'bg'],
  ['accent', 'surface'],
  ['on-accent', 'accent'],
  ['on-accent', 'accent-hover'],
  ['success', 'bg'],
  ['success', 'surface'],
  ['success', 'success-bg'],
  ['danger', 'bg'],
  ['danger', 'surface'],
  ['danger', 'danger-bg'],
  ['warning', 'bg'],
  ['warning', 'surface'],
  ['warning', 'warning-bg'],
  ['text', 'warning-bg'],
  ['text-2', 'warning-bg'],
  // A toast is the text colour turned around: bg-text with text-bg.
  ['bg', 'text'],
];

describe.each([
  ['light', light],
  ['dark', dark],
])('the %s theme', (_name, theme) => {
  it.each(PAIRS)('reads %s on %s at WCAG AA (4.5:1)', (text, surface) => {
    expect(contrast(theme[text]!, theme[surface]!)).toBeGreaterThanOrEqual(4.5);
  });

  it('reads text and the accent on an occupied table (bg-accent/10)', () => {
    const tint = over(theme.accent!, theme.surface!, 0.1);
    expect(contrast(theme.text!, tint)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(theme['text-2']!, tint)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(theme.accent!, tint)).toBeGreaterThanOrEqual(4.5);
    // A busy table with dishes ready says so in the success colour.
    expect(contrast(theme.success!, tint)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the accent, the focus ring, apart from the surfaces (3:1)', () => {
    expect(contrast(theme.accent!, theme.surface!)).toBeGreaterThanOrEqual(3);
    expect(contrast(theme.accent!, theme.bg!)).toBeGreaterThanOrEqual(3);
  });
});

describe('dark theme', () => {
  it('replaces every light colour', () => {
    expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort());
  });

  it('holds the same values for "Koyu" and for a dark system', () => {
    expect(colours(":root:not([data-theme='light'])")).toEqual(dark);
  });

  it('stays off paper: the dark colours apply on screen only', () => {
    expect(css).toMatch(/@media screen \{\s*:root\[data-theme='dark'\]/);
    expect(css).toMatch(
      /@media screen and \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme='light'\]\)/,
    );
  });

  it('is never pure black', () => {
    expect(luminance(dark.bg!)).toBeGreaterThan(luminance('#0a0a0a'));
    expect(luminance(dark.surface!)).toBeGreaterThan(luminance(dark.bg!));
  });
});

describe('browser bar colour', () => {
  it('matches each theme’s background', () => {
    const html = readFileSync('index.html', 'utf8').toLowerCase();
    expect(html).toContain(
      `<meta name="theme-color" media="(prefers-color-scheme: light)" content="${light.bg}" />`,
    );
    expect(html).toContain(
      `<meta name="theme-color" media="(prefers-color-scheme: dark)" content="${dark.bg}" />`,
    );
  });
});
