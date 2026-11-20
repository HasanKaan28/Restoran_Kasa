import { businessDate } from '@/domain/businessDate';
import type { MarketDb } from './db';

const KEY = 'license';

/** The market's plan and licence end as the server sends them with every pull. */
export type ServerLicense = {
  plan: string;
  planName: string;
  /** Null: any number of registers. */
  maxDevices: number | null;
  /** When the licence ends (ISO time); null for a market without an end. */
  licenseExpiresAt: string | null;
};

export type LicensePlan = { id: string; name: string; maxDevices: number | null };

/**
 * What the register keeps of it: the licence's last day in Turkey (YYYY-MM-DD), or null for a
 * licence without an end, and the plan when the server named one.
 */
export type StoredLicense = { expiresAt: string | null; plan?: LicensePlan };

/** The licence as last heard from the server; null when it never said. */
export async function loadStoredLicense(db: MarketDb): Promise<StoredLicense | null> {
  const value = (await db.meta.get(KEY))?.value;
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const { expiresAt, plan } = value as Record<string, unknown>;
  if (typeof expiresAt !== 'string' && expiresAt !== null) {
    return null;
  }
  return isPlan(plan) ? { expiresAt, plan } : { expiresAt };
}

/** The last day the market's licence covers, as last heard from the server; null if none. */
export async function loadLicense(db: MarketDb): Promise<string | null> {
  return (await loadStoredLicense(db))?.expiresAt ?? null;
}

export async function saveLicense(db: MarketDb, expiresAt: string): Promise<void> {
  await db.meta.put({ key: KEY, value: { expiresAt } });
}

/** Keeps what the server said; an answer of the wrong shape changes nothing. */
export async function saveServerLicense(db: MarketDb, license: unknown): Promise<void> {
  if (typeof license !== 'object' || license === null) {
    return;
  }
  const { plan, planName, maxDevices, licenseExpiresAt } = license as Record<string, unknown>;
  const ends = typeof licenseExpiresAt === 'string' ? new Date(licenseExpiresAt) : null;
  if ((ends === null && licenseExpiresAt !== null) || (ends && Number.isNaN(ends.getTime()))) {
    return;
  }
  const kept: StoredLicense = { expiresAt: ends ? businessDate(ends) : null };
  const named = { id: plan, name: planName, maxDevices };
  if (isPlan(named)) {
    kept.plan = named;
  }
  await db.meta.put({ key: KEY, value: kept });
}

function isPlan(value: unknown): value is LicensePlan {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const { id, name, maxDevices } = value as Record<string, unknown>;
  return (
    typeof id === 'string' &&
    typeof name === 'string' &&
    (maxDevices === null || (typeof maxDevices === 'number' && Number.isInteger(maxDevices)))
  );
}
