import { describe, expect, it } from 'vitest';
import { tableLabelIn } from './tableTitle';

const table = (id: string, name: string, area: string, archivedAt?: string) => ({
  id,
  name,
  area,
  ...(archivedAt ? { archivedAt } : {}),
});

describe('tableLabelIn', () => {
  it('keeps the plain name while it is unique among active tables', () => {
    const tables = [table('a', '1', 'Salon'), table('b', '2', 'Salon')];
    expect(tableLabelIn(tables[0]!, tables)).toBe('1');
  });

  it('puts the area before a name two areas share', () => {
    const tables = [table('a', '1', 'Salon'), table('b', '1', 'Dışarı')];
    expect(tableLabelIn(tables[0]!, tables)).toBe('Salon 1');
    expect(tableLabelIn(tables[1]!, tables)).toBe('Dışarı 1');
  });

  it('ignores a table taken out of use when judging uniqueness', () => {
    const tables = [table('a', '1', 'Salon'), table('b', '1', 'Dışarı', '2026-01-01')];
    expect(tableLabelIn(tables[0]!, tables)).toBe('1');
  });

  it('qualifies an archived table that an active one shares a name with', () => {
    const tables = [table('a', '1', 'Salon'), table('b', '1', 'Dışarı', '2026-01-01')];
    expect(tableLabelIn(tables[1]!, tables)).toBe('Dışarı 1');
  });

  it('matches names without regard to case or padding and falls back to Salon', () => {
    const tables = [table('a', 'B1', ''), table('b', ' b1 ', 'Bahçe')];
    expect(tableLabelIn(tables[0]!, tables)).toBe('Salon B1');
  });
});
