import { beforeEach, describe, expect, it } from 'vitest';
import {
  CHECKED_KEY,
  SNOOZE_KEY,
  describeCheckedAt,
  isSnoozed,
  loadCheckedAt,
  saveCheckedAt,
  snoozeRelease,
} from './updateTimes';

const HOUR = 60 * 60 * 1000;
// 20 Kasım 2026, 14:05 in Türkiye (UTC+3).
const NOW = Date.UTC(2026, 10, 20, 11, 5);

describe('update times on this device', () => {
  beforeEach(() => localStorage.clear());

  it('keeps them under this app’s own rk.* names', () => {
    expect(CHECKED_KEY).toMatch(/^rk\./);
    expect(SNOOZE_KEY).toMatch(/^rk\./);
  });

  it('remembers when the last check came back', () => {
    expect(loadCheckedAt(localStorage)).toBeNull();
    saveCheckedAt(localStorage, NOW);
    expect(loadCheckedAt(localStorage)).toBe(NOW);
    localStorage.setItem(CHECKED_KEY, 'bozuk');
    expect(loadCheckedAt(localStorage)).toBeNull();
  });

  it('puts a release off for a day with "Sonra", and a newer release breaks through', () => {
    expect(isSnoozed(localStorage, '1.2.0', NOW)).toBe(false);
    snoozeRelease(localStorage, '1.2.0', NOW);
    expect(isSnoozed(localStorage, '1.2.0', NOW + 23 * HOUR)).toBe(true);
    expect(isSnoozed(localStorage, '1.2.0', NOW + 24 * HOUR)).toBe(false);
    expect(isSnoozed(localStorage, '1.3.0', NOW + HOUR)).toBe(false);
  });

  it('carries on when the browser refuses storage', () => {
    const refusing = {
      getItem: () => {
        throw new DOMException('denied', 'SecurityError');
      },
      setItem: () => {
        throw new DOMException('denied', 'SecurityError');
      },
    } as unknown as Storage;
    expect(loadCheckedAt(refusing)).toBeNull();
    expect(() => saveCheckedAt(refusing, NOW)).not.toThrow();
    expect(() => snoozeRelease(refusing, '1.2.0', NOW)).not.toThrow();
    expect(isSnoozed(refusing, '1.2.0', NOW)).toBe(false);
  });

  it('says when the last check was in a shop’s words', () => {
    const zone = 'Europe/Istanbul';
    expect(describeCheckedAt(null, NOW, zone)).toBe('Henüz denetlenmedi');
    expect(describeCheckedAt(NOW - 20_000, NOW, zone)).toBe('Son denetim: az önce');
    expect(describeCheckedAt(NOW - 2 * HOUR, NOW, zone)).toBe('Son denetim: bugün 12:05');
    expect(describeCheckedAt(NOW - 20 * HOUR, NOW, zone)).toBe('Son denetim: dün 18:05');
    expect(describeCheckedAt(NOW - 72 * HOUR, NOW, zone)).toBe('Son denetim: 17 Kasım 14:05');
  });
});
