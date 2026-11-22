import { describe, expect, it } from 'vitest';
import { nextTableNumber, suggestedRun } from './tableNumbering';

type T = { name: string; area: string; archivedAt?: string };
const salon = (count: number): T[] =>
  Array.from({ length: count }, (_, index) => ({ name: String(index + 1), area: 'Salon' }));

describe('nextTableNumber', () => {
  it('starts an area at 1 when it holds no table yet, whatever the other areas hold', () => {
    expect(nextTableNumber(salon(10), 'Dışarı')).toBe(1);
  });

  it('continues from the largest number of its own area', () => {
    expect(nextTableNumber([...salon(10), { name: '1', area: 'Dışarı' }], 'Dışarı')).toBe(2);
    expect(nextTableNumber(salon(10), 'Salon')).toBe(11);
  });

  it('reads plain numbers, "<Area> <n>" and the typed prefix; skips other names', () => {
    const tables: T[] = [
      { name: 'Salon 4', area: 'Salon' },
      { name: 'Köşe', area: 'Salon' },
      { name: 'B7', area: 'Salon' },
      { name: '2', area: 'Salon' },
    ];
    expect(nextTableNumber(tables, 'Salon')).toBe(5);
    expect(nextTableNumber(tables, 'Salon', 'B')).toBe(8);
  });

  it('ignores archived tables, so a freed number is offered again', () => {
    const tables: T[] = [...salon(3), { name: '4', area: 'Salon', archivedAt: '2026-01-01' }];
    expect(nextTableNumber(tables, 'Salon')).toBe(4);
  });

  it('matches the area ignoring case and spaces at the ends; blank area is Salon', () => {
    expect(nextTableNumber(salon(2), ' salon ')).toBe(3);
    expect(nextTableNumber(salon(2), '')).toBe(3);
  });
});

describe('suggestedRun', () => {
  it('offers 1 to 10 when there is no table at all', () => {
    expect(suggestedRun([], 'Salon')).toEqual({ from: 1, to: 10 });
  });

  it('offers one table when others exist', () => {
    expect(suggestedRun(salon(10), 'Dışarı')).toEqual({ from: 1, to: 1 });
    expect(suggestedRun(salon(10), 'Salon')).toEqual({ from: 11, to: 11 });
  });
});
