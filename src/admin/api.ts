import { createClient } from '@supabase/supabase-js';
import type { ServerConfig } from '@/server/config';
import type { PlanId } from './model';

type Failure = { message: string; code?: string } | null;

/** The part of the Supabase client the yönetim page uses, so tests can stand in for it. */
export type OperatorClient = {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: Failure }>;
  auth: {
    getSession(): Promise<{ data: { session: { user: { email?: string } } | null } }>;
    signInWithPassword(credentials: {
      email: string;
      password: string;
    }): Promise<{ data: { session: { user: { email?: string } } | null }; error: Failure }>;
    signUp(credentials: {
      email: string;
      password: string;
      options?: { emailRedirectTo?: string };
    }): Promise<{ data: { session: { user: { email?: string } } | null }; error: Failure }>;
    signOut(options?: { scope: 'local' | 'global' | 'others' }): Promise<{ error: Failure }>;
  };
};

/**
 * The seller's own client: his session is kept on his phone under its own key (rk.operator), apart
 * from any register's session on the same browser, and comes back from an email confirmation link.
 */
export function operatorClient(config: ServerConfig): OperatorClient {
  return createClient(config.url, config.key, {
    auth: {
      storageKey: 'rk.operator',
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  }) as unknown as OperatorClient;
}

export type CodeStatus = 'unused' | 'used' | 'revoked';

export type ActivationCode = {
  code: string;
  plan: PlanId;
  planName: string;
  days: number;
  note: string | null;
  createdAt: string;
  usedAt: string | null;
  revokedAt: string | null;
  marketId: string | null;
  marketName: string | null;
  status: CodeStatus;
};

export type Restaurant = {
  id: string;
  name: string;
  status: string;
  plan: PlanId;
  planName: string;
  /** The restaurant's own limit when the operator set one, else its plan's; null: any number. */
  maxDevices: number | null;
  planMaxDevices: number | null;
  maxDevicesOverride: number | null;
  createdAt: string;
  /** Set when the operator deleted it (softly: it is suspended and kept). */
  deletedAt: string | null;
  licenseExpiresAt: string | null;
  devices: number;
  lastSeenAt: string | null;
  ownerEmail: string | null;
};

export type Overview = {
  restaurants: Record<
    'total' | 'active' | 'suspended' | 'expiring' | 'expired' | 'deleted',
    number
  >;
  codes: Record<'issued' | 'used' | 'unused' | 'revoked', number>;
  devices: { total: number; seenToday: number };
  expiring: {
    id: string;
    name: string;
    status: string;
    planName: string;
    licenseExpiresAt: string;
  }[];
};

/** What a restaurant synced in the last 30 days, as counts only. */
export type Activity = { sales: number; tabs: number; activeDevices: number };

export type Device = {
  id: string;
  code: string;
  name: string;
  platform: string;
  createdAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
};

export type RestaurantDetail = {
  id: string;
  name: string;
  status: string;
  deletedAt: string | null;
  plan: PlanId;
  planName: string;
  planMaxDevices: number | null;
  maxDevicesOverride: number | null;
  maxDevices: number | null;
  licenseExpiresAt: string | null;
  createdAt: string;
  ownerEmail: string | null;
  storage: { bytes: number; limitBytes: number };
  rowCounts: { table: string; count: number }[];
  lastSyncAt: string | null;
  qrMenu: { enabled: boolean; slug: string } | null;
  note: string | null;
  devices: Device[];
  activity: Activity;
};

export type LogEntry = {
  id: number;
  at: string;
  action: string;
  marketId: string | null;
  marketName: string | null;
  operatorEmail: string | null;
  details: Record<string, unknown>;
};

export type Announcement = {
  id: string;
  marketId: string | null;
  marketName: string | null;
  message: string;
  createdAt: string;
  expiresAt: string | null;
  removedAt: string | null;
  live: boolean;
};

export type CodeFilter = { status: CodeStatus | null; search: string };

const OFFLINE = 'Bağlantı kurulamadı. İnternet bağlantısını kontrol edin.';

/** What the server's refusals mean to the seller. */
const MESSAGES: Record<string, string> = {
  not_operator: 'Bu hesap yönetici değil.',
  bad_plan: 'Paket geçersiz.',
  bad_days: 'Süre 1 ile 3660 gün arasında olmalı.',
  bad_note: 'Not en çok 200 karakter olabilir.',
  code_used: 'Bu kod kullanılmış; iptal edilemez.',
  code_not_found: 'Kod bulunamadı.',
  market_not_found: 'Restoran bulunamadı.',
  license_unlimited: 'Bu restoranın lisansı süresiz; uzatılmaz.',
  license_expired: 'Restoran askıda ya da lisansı bitmiş: önce etkinleştirin ya da süreyi uzatın.',
  bad_status: 'Durum geçersiz.',
  bad_date: 'Tarih bugünden en çok 10 yıl önce ya da sonra olabilir.',
  bad_max_devices: 'Cihaz sınırı 1 ile 999 arasında olmalı.',
  bad_name: 'Ad 1 ile 60 karakter arasında olmalı.',
  bad_count: 'Adet 1 ile 50 arasında olmalı.',
  bad_message: 'Duyuru 1 ile 280 karakter arasında olmalı.',
  note_too_long: 'Not en çok 2000 karakter olabilir.',
  name_mismatch: 'Yazılan ad restoranın adıyla aynı değil.',
  device_not_found: 'Cihaz bulunamadı.',
  announcement_not_found: 'Duyuru bulunamadı.',
};

export function explain(message: string): string {
  const known = Object.keys(MESSAGES).find((key) => message.includes(key));
  return known ? (MESSAGES[known] as string) : OFFLINE;
}

/**
 * The operator functions of the server (supabase/migrations/20261121120000_activation.sql and
 * 20261127120000_operator_console.sql).
 */
export function operatorApi(client: OperatorClient) {
  async function call<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    let answer: { data: unknown; error: Failure };
    try {
      answer = await client.rpc(fn, args);
    } catch {
      throw new Error(OFFLINE);
    }
    if (answer.error) {
      throw new Error(explain(answer.error.message));
    }
    return answer.data as T;
  }
  return {
    whoami: () => call<boolean>('operator_whoami'),
    issueCode: (plan: PlanId, days: number, note: string) =>
      call<string>('issue_activation_code', { plan_id: plan, days, note: note.trim() }),
    issueCodes: (plan: PlanId, days: number, note: string, count: number) =>
      call<string[]>('operator_issue_codes', { plan_id: plan, days, note: note.trim(), count }),
    listCodes: (filter: CodeFilter = { status: null, search: '' }, limit = 200) =>
      call<ActivationCode[]>('operator_list_codes', {
        lim: limit,
        status: filter.status,
        search: filter.search.trim() || null,
      }),
    revokeCode: (code: string) => call<void>('revoke_activation_code', { code }),
    listRestaurants: (limit = 200) => call<Restaurant[]>('list_markets', { lim: limit }),
    extendLicense: (marketId: string, days: number) =>
      call<{ licenseExpiresAt: string }>('extend_license', { market_id: marketId, days }),
    setPlan: (marketId: string, plan: PlanId) =>
      call<void>('set_market_plan', { market_id: marketId, plan_id: plan }),
    overview: () => call<Overview>('operator_overview'),
    restaurant: (marketId: string) =>
      call<RestaurantDetail>('operator_market', { market_id: marketId }),
    activity: (limit = 200) =>
      call<({ id: string; name: string } & Activity)[]>('operator_activity', { lim: limit }),
    history: ({
      limit = 50,
      beforeId = null,
      marketId = null,
    }: { limit?: number; beforeId?: number | null; marketId?: string | null } = {}) =>
      call<LogEntry[]>('operator_history', {
        lim: limit,
        before_id: beforeId,
        market_id: marketId,
      }),
    setStatus: (marketId: string, status: 'active' | 'suspended') =>
      call<{ status: string; deletedAt: string | null }>('operator_set_market_status', {
        market_id: marketId,
        status,
      }),
    setLicense: (marketId: string, expiresAt: string | null) =>
      call<{ licenseExpiresAt: string | null }>('operator_set_license', {
        market_id: marketId,
        expires_at: expiresAt,
      }),
    setMaxDevices: (marketId: string, maxDevices: number | null) =>
      call<{ maxDevices: number | null }>('operator_set_max_devices', {
        market_id: marketId,
        max_devices: maxDevices,
      }),
    renameRestaurant: (marketId: string, name: string) =>
      call<{ name: string }>('operator_rename_market', { market_id: marketId, name: name.trim() }),
    setQrMenu: (marketId: string, enabled: boolean) =>
      call<{ enabled: boolean; slug: string }>('operator_set_qr_menu', {
        market_id: marketId,
        enabled,
      }),
    rotateQrMenu: (marketId: string) =>
      call<{ enabled: boolean; slug: string }>('operator_rotate_qr_menu', { market_id: marketId }),
    createPairing: (marketId: string) =>
      call<{ code: string; expiresAt: string }>('operator_create_pairing', {
        market_id: marketId,
      }),
    setNote: (marketId: string, note: string) =>
      call<void>('operator_set_note', { market_id: marketId, note }),
    deleteRestaurant: (marketId: string, confirmName: string) =>
      call<{ deletedAt: string }>('operator_delete_market', {
        market_id: marketId,
        confirm_name: confirmName,
      }),
    revokeDevice: (deviceId: string) =>
      call<void>('operator_revoke_device', { device_id: deviceId }),
    renameDevice: (deviceId: string, name: string) =>
      call<void>('operator_rename_device', { device_id: deviceId, name: name.trim() }),
    announce: (marketId: string | null, message: string, days: number | null) =>
      call<{ id: string }>('operator_set_announcement', {
        market_id: marketId,
        message: message.trim(),
        days,
      }),
    removeAnnouncement: (id: string) => call<void>('operator_remove_announcement', { id }),
    listAnnouncements: (limit = 100) =>
      call<Announcement[]>('operator_list_announcements', { lim: limit }),
  };
}

export type OperatorApi = ReturnType<typeof operatorApi>;
