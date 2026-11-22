import { describe, expect, it } from 'vitest';
import { chooseSlipMode, DEFAULT_SLIP_PREFS, loadSlipPrefs, SLIP_STORAGE_KEY } from './slipPrefs';

function memory(initial?: string) {
  const values = new Map<string, string>();
  if (initial !== undefined) {
    values.set(SLIP_STORAGE_KEY, initial);
  }
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

describe('slip preferences', () => {
  it('prints nothing until this device is told to', () => {
    expect(DEFAULT_SLIP_PREFS).toEqual({ mode: 'off' });
    expect(loadSlipPrefs(memory())).toEqual({ mode: 'off' });
  });

  it('keeps the moment a choice was made, so orders before it are never printed', () => {
    const storage = memory();
    chooseSlipMode('delivered', new Date('2026-11-22T18:00:00Z'), storage);
    expect(loadSlipPrefs(storage)).toEqual({
      mode: 'delivered',
      since: '2026-11-22T18:00:00.000Z',
    });

    // A new choice starts again from its own moment; choosing the same again changes nothing.
    chooseSlipMode('all', new Date('2026-11-22T19:00:00Z'), storage);
    chooseSlipMode('all', new Date('2026-11-22T20:00:00Z'), storage);
    expect(loadSlipPrefs(storage)).toEqual({ mode: 'all', since: '2026-11-22T19:00:00.000Z' });
  });

  it('falls back to off when the stored value is broken or unreadable', () => {
    expect(loadSlipPrefs(memory('not json'))).toEqual(DEFAULT_SLIP_PREFS);
    expect(loadSlipPrefs(memory('{"mode":"loud","since":"x"}'))).toEqual(DEFAULT_SLIP_PREFS);
    // On, but with no moment to start from: nothing could be told apart from the old orders.
    expect(loadSlipPrefs(memory('{"mode":"all"}'))).toEqual(DEFAULT_SLIP_PREFS);
    expect(
      loadSlipPrefs({
        getItem: () => {
          throw new Error('blocked');
        },
      }),
    ).toEqual(DEFAULT_SLIP_PREFS);
  });
});
