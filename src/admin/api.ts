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
  maxDevices: number | null;
  createdAt: string;
  licenseExpiresAt: string | null;
  devices: number;
  lastSeenAt: string | null;
  ownerEmail: string | null;
};

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
};

export function explain(message: string): string {
  const known = Object.keys(MESSAGES).find((key) => message.includes(key));
  return known ? (MESSAGES[known] as string) : OFFLINE;
}

/** The operator functions of the server (supabase/migrations/20261121120000_activation.sql). */
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
    listCodes: (limit = 100) => call<ActivationCode[]>('list_activation_codes', { lim: limit }),
    revokeCode: (code: string) => call<void>('revoke_activation_code', { code }),
    listRestaurants: (limit = 200) => call<Restaurant[]>('list_markets', { lim: limit }),
    extendLicense: (marketId: string, days: number) =>
      call<{ licenseExpiresAt: string }>('extend_license', { market_id: marketId, days }),
    setPlan: (marketId: string, plan: PlanId) =>
      call<void>('set_market_plan', { market_id: marketId, plan_id: plan }),
  };
}

export type OperatorApi = ReturnType<typeof operatorApi>;
