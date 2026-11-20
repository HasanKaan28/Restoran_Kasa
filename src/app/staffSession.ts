import type { MarketDb } from '@/data/db';
import type { StaffRecord } from '@/data/types';

/**
 * Who is signed in on this register, kept across a reload. The browser's storage holds the
 * person's id and a random token; the market's database on this device holds the token's SHA-256
 * and the PIN hash the person signed in with. A session resumes only when the two agree and the
 * PIN is unchanged, so a person's id written into the storage (every register has every id, in
 * the synced rows) signs nobody in, and a PIN change ends the person's sessions.
 *
 * Anyone who can run code in the page (developer tools, a script on the same address) can still
 * do anything a register can: PINs guard the till against the people at it, not against that.
 */

const STORAGE_KEY = 'rk.staff';
const META_KEY = 'staffSession';
const TOKEN_BYTES = 32;

type Claim = { id: string; token: string };
type Kept = { staffId: string; tokenHash: string; pinHash: string };

/** Starts a session for a person who has just given their PIN (or set it). */
export async function startStaffSession(
  db: MarketDb,
  staff: Pick<StaffRecord, 'id' | 'pinHash'>,
): Promise<void> {
  const token = randomToken();
  const kept: Kept = { staffId: staff.id, tokenHash: await sha256(token), pinHash: staff.pinHash };
  await db.meta.put({ key: META_KEY, value: kept });
  writeClaim({ id: staff.id, token });
}

/** Ends the session on this register: the next one starts at the sign-in screen. */
export async function endStaffSession(db: MarketDb): Promise<void> {
  writeClaim(null);
  await db.meta.delete(META_KEY);
}

/**
 * The person whose session this register resumes after a reload, or null. A session that does not
 * hold (an id typed into the storage, a token moved to another person, a changed PIN) is dropped.
 */
export async function resumeStaffSession(db: MarketDb): Promise<string | null> {
  const claim = readClaim();
  if (claim === undefined) {
    return null;
  }
  const kept = claim ? readKept((await db.meta.get(META_KEY))?.value) : null;
  const staff = claim && kept ? await db.staff.get(claim.id) : undefined;
  if (
    claim &&
    kept &&
    staff &&
    kept.staffId === claim.id &&
    kept.pinHash === staff.pinHash &&
    sameText(kept.tokenHash, await sha256(claim.token))
  ) {
    return claim.id;
  }
  await endStaffSession(db);
  return null;
}

/** The stored claim; undefined when there is none, null when there is one that is malformed. */
function readClaim(): Claim | null | undefined {
  let text: string | null;
  try {
    text = localStorage.getItem(STORAGE_KEY);
  } catch {
    return undefined;
  }
  if (text === null) {
    return undefined;
  }
  try {
    const { id, token } = JSON.parse(text) as Partial<Claim>;
    return typeof id === 'string' && typeof token === 'string' ? { id, token } : null;
  } catch {
    return null;
  }
}

function writeClaim(claim: Claim | null): void {
  try {
    if (claim === null) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(claim));
    }
  } catch {
    // Storage blocked: the session lasts until the page is closed.
  }
}

function readKept(value: unknown): Kept | null {
  const { staffId, tokenHash, pinHash } = (value ?? {}) as Partial<Kept>;
  return typeof staffId === 'string' && typeof tokenHash === 'string' && typeof pinHash === 'string'
    ? { staffId, tokenHash, pinHash }
    : null;
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(TOKEN_BYTES));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

// Compares every character whatever the first difference, so timing says nothing of the hash.
function sameText(a: string, b: string): boolean {
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    difference |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  }
  return difference === 0;
}
