import { describe, expect, it } from 'vitest';
import { codeMessage, daysUntil, lastSeenText, licenseText, periodLabel } from './model';

const now = new Date('2026-11-20T10:00:00Z');
const inDays = (days: number) => new Date(now.getTime() + days * 86_400_000).toISOString();

describe('the yönetim page’s words', () => {
  it('writes the code into a message the restaurant can act on', () => {
    expect(codeMessage('RK-ABCD-EFGH-JKMN')).toBe(
      'Restoran Kasa kurulum kodunuz: RK-ABCD-EFGH-JKMN\nUygulama: https://restorankasa.vercel.app/app/ → Restoran kur',
    );
  });

  it('names a sold period, and any other number of days as days', () => {
    expect(periodLabel(14)).toBe('14 gün deneme');
    expect(periodLabel(183)).toBe('6 ay sezon');
    expect(periodLabel(45)).toBe('45 gün');
  });

  it('counts the days left, the last part-day as one', () => {
    expect(daysUntil(inDays(2.2), now)).toBe(3);
    expect(daysUntil(inDays(-0.5), now)).toBe(0);
  });

  it('says where a licence stands and how urgent it is', () => {
    expect(licenseText(null, now)).toEqual({ text: 'Süresiz', tone: 'ok' });
    expect(licenseText(inDays(30), now)).toEqual({ text: '30 gün kaldı', tone: 'ok' });
    expect(licenseText(inDays(3), now)).toEqual({ text: '3 gün kaldı', tone: 'warning' });
    expect(licenseText(inDays(-2), now)).toEqual({
      text: 'Süre doldu · eşitleme 5 gün daha açık',
      tone: 'danger',
    });
    expect(licenseText(inDays(-8), now)).toEqual({
      text: 'Süre doldu · eşitleme kapalı',
      tone: 'danger',
    });
  });

  it('says when a register was last seen', () => {
    const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();
    expect(lastSeenText(null, now)).toBe('Hiç görülmedi');
    expect(lastSeenText(ago(1), now)).toBe('Az önce');
    expect(lastSeenText(ago(25), now)).toBe('25 dk önce');
    expect(lastSeenText(ago(180), now)).toBe('3 saat önce');
    expect(lastSeenText(ago(3 * 24 * 60), now)).toBe('3 gün önce');
  });
});
