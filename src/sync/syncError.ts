import { DeviceRevokedError, DeviceUnpairedError, LicenseExpiredError } from './supabaseTransport';

const SAFE = 'Kayıtlar cihazda güvende.';
const NETWORK = /failed to fetch|networkerror|load failed|fetch failed|network request failed/i;
const TIMEOUT = /yanıt vermedi/;

/**
 * What a failed sync round shows: one plain sentence, and that nothing taken on this device is
 * lost. The raw text ("TypeError: Failed to fetch") goes to the console for whoever supports it.
 */
export function plainSyncError(error: unknown): string {
  if (
    error instanceof DeviceUnpairedError ||
    error instanceof DeviceRevokedError ||
    error instanceof LicenseExpiredError
  ) {
    return error.message;
  }
  const raw = error instanceof Error ? error.message : String(error);
  if (NETWORK.test(raw)) {
    return `Sunucuya ulaşılamıyor. ${SAFE}`;
  }
  if (TIMEOUT.test(raw)) {
    return `Sunucu yanıt vermiyor. ${SAFE}`;
  }
  return `Eşitlenemedi; birazdan yeniden denenecek. ${SAFE}`;
}
