import { describe, expect, it } from 'vitest';
import { DeviceRevokedError, DeviceUnpairedError, LicenseExpiredError } from './supabaseTransport';
import { plainSyncError } from './syncError';

describe('plainSyncError', () => {
  it('says in plain Turkish that the server is out of reach, never the browser’s words', () => {
    for (const raw of [
      new TypeError('Failed to fetch'),
      new TypeError('NetworkError when attempting to fetch resource.'),
      new TypeError('Load failed'),
      new Error('fetch failed'),
    ]) {
      expect(plainSyncError(raw)).toBe('Sunucuya ulaşılamıyor. Kayıtlar cihazda güvende.');
    }
  });

  it('tells a slow server apart', () => {
    expect(plainSyncError(new Error('Sunucu 30 saniyede yanıt vermedi'))).toBe(
      'Sunucu yanıt vermiyor. Kayıtlar cihazda güvende.',
    );
  });

  it('keeps what the app itself explains, such as a register to pair again', () => {
    expect(plainSyncError(new DeviceUnpairedError())).toBe(new DeviceUnpairedError().message);
    expect(plainSyncError(new DeviceRevokedError())).toBe(new DeviceRevokedError().message);
    expect(plainSyncError(new LicenseExpiredError())).toBe(
      'Lisans süresi doldu; eşitleme durdu. Kayıtlar cihazda güvende.',
    );
  });

  it('turns anything else into one calm sentence', () => {
    expect(plainSyncError(new Error('duplicate key value violates unique constraint'))).toBe(
      'Eşitlenemedi; birazdan yeniden denenecek. Kayıtlar cihazda güvende.',
    );
    expect(plainSyncError('weird')).toBe(
      'Eşitlenemedi; birazdan yeniden denenecek. Kayıtlar cihazda güvende.',
    );
  });
});
