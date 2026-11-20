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

/** A moment as the seller reads it: 20 Kas 2026 14:05. */
export function dateTimeText(at: string): string {
  return new Intl.DateTimeFormat('tr-TR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Istanbul',
  }).format(new Date(at));
}

/** A size in bytes as one says it: 12,4 MB. */
export function bytesText(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  return `${new Intl.NumberFormat('tr-TR', { maximumFractionDigits: digits }).format(value)} ${units[unit]}`;
}

/** A count with Turkish digit grouping: 12.345. */
export function countText(count: number): string {
  return new Intl.NumberFormat('tr-TR').format(count);
}

/** Turkey keeps UTC+3 all year, so a day there is a fixed offset. */
const TURKEY_OFFSET = '+03:00';

/** The day (YYYY-MM-DD) a moment falls on in Turkey, for a date input. */
export function dayInTurkey(at: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date(at));
}

/** The last moment of a day in Turkey, so a licence set to end on a day covers all of it. */
export function endOfTurkishDay(day: string): string {
  return new Date(`${day}T23:59:59${TURKEY_OFFSET}`).toISOString();
}

/** The synced tables, as the seller would name them. */
const TABLES: Record<string, string> = {
  products: 'Ürün',
  categories: 'Kategori',
  customers: 'Müşteri',
  suppliers: 'Tedarikçi',
  staff: 'Personel',
  settings: 'Ayar',
  invoices: 'Fatura',
  diningTables: 'Masa',
  tabs: 'Adisyon',
  tabItems: 'Adisyon kalemi',
  tabPayments: 'Adisyon ödemesi',
  sales: 'Satış',
  saleVoids: 'Satış iptali',
  returns: 'İade',
  stockMovements: 'Stok hareketi',
  stockCounts: 'Sayım',
  purchases: 'Alış',
  ledger: 'Veresiye hareketi',
  supplierLedger: 'Tedarikçi hesabı',
  cashMovements: 'Kasa hareketi',
  cashSessions: 'Kasa oturumu',
  auditLog: 'İşlem kaydı',
};

export function tableLabel(table: string): string {
  return TABLES[table] ?? table;
}

const PLATFORMS: Record<string, string> = {
  windows: 'Windows',
  android: 'Android',
  web: 'Tarayıcı',
};

export function platformLabel(platform: string): string {
  return PLATFORMS[platform] ?? platform;
}

/** A restaurant's state in a word, and how it is drawn. */
export function statusText(
  status: string,
  deletedAt: string | null,
): { text: string; tone: 'ok' | 'warning' | 'danger' } {
  if (deletedAt !== null) {
    return { text: 'Silindi', tone: 'danger' };
  }
  return status === 'active' ? { text: 'Etkin', tone: 'ok' } : { text: 'Askıda', tone: 'warning' };
}

const ACTIONS: Record<string, string> = {
  'code.issue': 'Kod üretildi',
  'code.revoke': 'Kod iptal edildi',
  'license.extend': 'Süre uzatıldı',
  'license.set': 'Lisans bitişi ayarlandı',
  'market.plan': 'Paket değişti',
  'market.status': 'Durum değişti',
  'market.max_devices': 'Cihaz sınırı değişti',
  'market.rename': 'Restoran adı değişti',
  'market.delete': 'Restoran silindi',
  'qr.set': 'QR menü',
  'qr.rotate': 'QR menüye yeni bağlantı',
  'pairing.create': 'Destek eşleşme kodu üretildi',
  'note.set': 'Özel not',
  'device.revoke': 'Cihaz iptal edildi',
  'device.rename': 'Cihaz adı değişti',
  'announcement.create': 'Duyuru yayınlandı',
  'announcement.remove': 'Duyuru kaldırıldı',
};

export function actionLabel(action: string): string {
  return ACTIONS[action] ?? action;
}

const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/** What an operator log line changed, in a few words; empty when the label says it all. */
export function actionDetail(action: string, details: Record<string, unknown>): string {
  const when = (value: unknown) => (str(value) ? dayText(str(value) as string) : 'süresiz');
  switch (action) {
    case 'code.issue': {
      const count = Number(details.count ?? 1);
      const plan = PLANS.find((item) => item.id === details.plan)?.name ?? str(details.plan) ?? '';
      const note = str(details.note);
      return `${count} kod · ${plan} · ${periodLabel(Number(details.days))}${note ? ` · ${note}` : ''}`;
    }
    case 'code.revoke':
      return str(details.code) ?? '';
    case 'license.extend':
      return `${Number(details.days)} gün · yeni bitiş ${when(details.to)}`;
    case 'license.set':
      return `${when(details.from)} → ${when(details.to)}`;
    case 'market.plan': {
      const name = (id: unknown) => PLANS.find((item) => item.id === id)?.name ?? String(id);
      return `${name(details.from)} → ${name(details.to)}`;
    }
    case 'market.status':
      return details.restored === true
        ? 'Geri getirildi, etkin'
        : details.to === 'active'
          ? 'Etkinleştirildi'
          : 'Askıya alındı';
    case 'market.max_devices': {
      const limit = (value: unknown) => (value === null ? 'paketinki' : String(value));
      return `${limit(details.from)} → ${limit(details.to)}`;
    }
    case 'market.rename':
    case 'device.rename':
      return `${str(details.from) ?? ''} → ${str(details.to) ?? ''}`;
    case 'qr.set':
      return details.enabled === true ? 'Açıldı' : 'Kapatıldı';
    case 'device.revoke':
      return `${str(details.code) ?? ''} · ${str(details.name) ?? ''}`;
    case 'note.set':
      return Number(details.length) > 0 ? 'Kaydedildi' : 'Silindi';
    case 'announcement.create':
    case 'announcement.remove':
      return str(details.message) ?? '';
    default:
      return '';
  }
}

/** How many registers a restaurant has against its limit. */
export function devicesText(devices: number, maxDevices: number | null): string {
  return maxDevices === null ? `${devices} cihaz · sınırsız` : `${devices} / ${maxDevices} cihaz`;
}

/** The last 30 days in one line: counts only. */
export function activityText(activity: {
  sales: number;
  tabs: number;
  activeDevices: number;
}): string {
  return `${countText(activity.sales)} satış · ${countText(activity.tabs)} adisyon · ${countText(activity.activeDevices)} aktif cihaz`;
}
