import { vi } from 'vitest';
import type { ActivationCode, OperatorClient, Restaurant, RestaurantDetail } from '@/admin/api';

export type Answer = (args: Record<string, unknown>) => {
  data?: unknown;
  error?: { message: string };
};

/** A stand-in for the seller's Supabase client: a session, and each RPC answered by a function. */
export function fakeOperatorClient(answers: Record<string, Answer>, signedIn = false) {
  let session: { user: { email: string } } | null = signedIn
    ? { user: { email: 'satici@example.com' } }
    : null;
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const auth = {
    getSession: vi.fn(async () => ({ data: { session } })),
    signInWithPassword: vi.fn(async ({ email }: { email: string }) => {
      session = { user: { email } };
      return { data: { session }, error: null };
    }),
    signUp: vi.fn(async () => ({ data: { session: null }, error: null })),
    signOut: vi.fn(async () => {
      session = null;
      return { error: null };
    }),
  };
  const client = {
    auth,
    async rpc(fn: string, args: Record<string, unknown> = {}) {
      calls.push({ fn, args });
      const answer = answers[fn]?.(args) ?? {};
      return { data: answer.data ?? null, error: answer.error ?? null };
    },
  } as unknown as OperatorClient;
  /** The arguments of the last call to `fn`. */
  const last = (fn: string) => calls.filter((call) => call.fn === fn).at(-1)?.args;
  return { client, calls, auth, last };
}

/** An operator whose lists are empty unless a test answers them. */
export const operatorAnswers = (extra: Record<string, Answer> = {}): Record<string, Answer> => ({
  operator_whoami: () => ({ data: true }),
  operator_overview: () => ({
    data: {
      restaurants: { total: 0, active: 0, suspended: 0, expiring: 0, expired: 0, deleted: 0 },
      codes: { issued: 0, used: 0, unused: 0, revoked: 0 },
      devices: { total: 0, seenToday: 0 },
      expiring: [],
    },
  }),
  operator_list_codes: () => ({ data: [] }),
  list_markets: () => ({ data: [] }),
  operator_activity: () => ({ data: [] }),
  operator_history: () => ({ data: [] }),
  operator_list_announcements: () => ({ data: [] }),
  ...extra,
});

export const activationCode = (fields: Partial<ActivationCode>): ActivationCode => ({
  code: 'RK-AAAA-BBBB-CCCC',
  plan: 'restoran',
  planName: 'Restoran',
  days: 365,
  note: null,
  createdAt: '2026-11-19T10:00:00Z',
  usedAt: null,
  revokedAt: null,
  marketId: null,
  marketName: null,
  status: 'unused',
  ...fields,
});

export const restaurantRow = (fields: Partial<Restaurant>): Restaurant => ({
  id: 'kebapci-halil-ab12cd',
  name: 'Kebapçı Halil',
  status: 'active',
  plan: 'restoran',
  planName: 'Restoran',
  maxDevices: 5,
  planMaxDevices: 5,
  maxDevicesOverride: null,
  createdAt: '2026-11-01T10:00:00Z',
  deletedAt: null,
  licenseExpiresAt: new Date(Date.now() + 40 * 86_400_000).toISOString(),
  devices: 2,
  lastSeenAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
  ownerEmail: 'halil@example.com',
  ...fields,
});

export const restaurantDetail = (fields: Partial<RestaurantDetail>): RestaurantDetail => ({
  id: 'kebapci-halil-ab12cd',
  name: 'Kebapçı Halil',
  status: 'active',
  deletedAt: null,
  plan: 'restoran',
  planName: 'Restoran',
  planMaxDevices: 5,
  maxDevicesOverride: null,
  maxDevices: 5,
  licenseExpiresAt: new Date(Date.now() + 40 * 86_400_000).toISOString(),
  createdAt: '2026-11-01T10:00:00Z',
  ownerEmail: 'halil@example.com',
  storage: { bytes: 3 * 1024 * 1024, limitBytes: 200 * 1024 * 1024 },
  rowCounts: [
    { table: 'products', count: 84 },
    { table: 'sales', count: 1250 },
  ],
  lastSyncAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  qrMenu: { enabled: true, slug: 'AbCdEfGhIjKlMnOpQrStUvWxYz' },
  note: null,
  devices: [
    {
      id: 'd2',
      code: 'K2',
      name: 'Bar tableti',
      platform: 'android',
      createdAt: '2026-11-03T10:00:00Z',
      lastSeenAt: new Date(Date.now() - 60_000).toISOString(),
      revokedAt: null,
    },
    {
      id: 'd1',
      code: 'K1',
      name: 'Eski kasa',
      platform: 'windows',
      createdAt: '2026-11-01T10:00:00Z',
      lastSeenAt: '2026-11-02T10:00:00Z',
      revokedAt: '2026-11-03T09:00:00Z',
    },
  ],
  activity: { sales: 412, tabs: 96, activeDevices: 1 },
  ...fields,
});
