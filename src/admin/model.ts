/** What the yönetim page shows: plans, periods and the words for a code's or a licence's state. */

export type PlanId = 'qr' | 'restoran' | 'pro';

export const PLANS: readonly { id: PlanId; name: string; devices: string }[] = [
  { id: 'qr', name: 'QR Menü', devices: '1 cihaz' },
  { id: 'restoran', name: 'Restoran', devices: '5 cihaz' },
  { id: 'pro', name: 'Restoran Pro', devices: 'sınırsız cihaz' },
];

/** The periods the seller sells (the pricing report's), in days. */
export const PERIODS: readonly { days: number; label: string }[] = [
  { days: 14, label: '14 gün deneme' },
  { days: 30, label: '1 ay' },
  { days: 90, label: '3 ay' },
  { days: 183, label: '6 ay sezon' },
  { days: 365, label: '1 yıl' },
];

export const MAX_DAYS = 3660;

/** Where a new restaurant installs the app; the message names it. */
export const APP_URL = 'https://restorankasa.vercel.app/app/';

/** The WhatsApp message that carries a code to the restaurant. */
export function codeMessage(code: string): string {
  return `Restoran Kasa kurulum kodunuz: ${code}\nUygulama: ${APP_URL} → Restoran kur`;
}

/** A number of days as the seller says it: the period's name when it is one. */
export function periodLabel(days: number): string {
  return PERIODS.find((period) => period.days === days)?.label ?? `${days} gün`;
}

/** Whole days from `now` to the end, rounded up, so the last afternoon still counts as one. */
export function daysUntil(end: string, now: Date): number {
  // + 0 turns the -0 of an end a few hours past into 0.
  return Math.ceil((Date.parse(end) - now.getTime()) / 86_400_000) + 0;
}

const GRACE_DAYS = 7;

/** Where a restaurant's licence stands, in a few words, and how urgent it is. */
export function licenseText(
  licenseExpiresAt: string | null,
  now: Date,
): { text: string; tone: 'ok' | 'warning' | 'danger' } {
  if (licenseExpiresAt === null) {
    return { text: 'Süresiz', tone: 'ok' };
  }
  const left = daysUntil(licenseExpiresAt, now);
  if (left > 7) {
    return { text: `${left} gün kaldı`, tone: 'ok' };
  }
  if (left > 0) {
    return { text: `${left} gün kaldı`, tone: 'warning' };
  }
  const grace = GRACE_DAYS + left;
  return grace > 0
    ? { text: `Süre doldu · eşitleme ${grace} gün daha açık`, tone: 'danger' }
    : { text: 'Süre doldu · eşitleme kapalı', tone: 'danger' };
}

/** When a register was last seen, as one says it. */
export function lastSeenText(lastSeenAt: string | null, now: Date): string {
  if (lastSeenAt === null) {
    return 'Hiç görülmedi';
  }
  const minutes = Math.floor((now.getTime() - Date.parse(lastSeenAt)) / 60_000);
  if (minutes < 2) {
    return 'Az önce';
  }
  if (minutes < 60) {
    return `${minutes} dk önce`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} saat önce`;
  }
  return `${Math.floor(hours / 24)} gün önce`;
}

/** A day as the seller reads it: 20 Kas 2026. */
export function dayText(at: string): string {
  return new Intl.DateTimeFormat('tr-TR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Europe/Istanbul',
  }).format(new Date(at));
}
