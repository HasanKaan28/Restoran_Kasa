import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MarketDb } from '@/data/db';
import { createStaff, setStaffPin } from '@/data/staff';
import type { StaffRecord } from '@/data/types';
import { makeTestDb } from '@/test/db';
import { endStaffSession, resumeStaffSession, startStaffSession } from './staffSession';

const at = new Date('2026-11-20T09:00:00Z');

let db: MarketDb;
let kaan: StaffRecord;
let ayse: StaffRecord;

beforeEach(async () => {
  db = makeTestDb();
  kaan = await createStaff(db, { name: 'Kaan', role: 'owner', pin: '4821' }, at);
  ayse = await createStaff(db, { name: 'Ayşe', role: 'cashier', pin: '1234' }, at);
});
afterEach(async () => {
  await db.delete();
});

describe('the staff session', () => {
  it('is resumed after a reload once someone has signed in', async () => {
    await startStaffSession(db, ayse);
    expect(await resumeStaffSession(db)).toBe(ayse.id);
    expect(await resumeStaffSession(db)).toBe(ayse.id);
  });

  it('keeps no secret in the browser storage that the database would accept on its own', async () => {
    await startStaffSession(db, ayse);
    const kept = JSON.stringify(await db.meta.get('staffSession'));
    const stored = localStorage.getItem('rk.staff') ?? '';
    const { token } = JSON.parse(stored) as { token: string };
    expect(token.length).toBeGreaterThanOrEqual(43);
    expect(kept).not.toContain(token);
  });

  it('signs nobody in from a person’s id typed into the storage', async () => {
    // The owner's id is in every synced row: before, this alone opened the register as the owner.
    localStorage.setItem('rk.staff', kaan.id);
    expect(await resumeStaffSession(db)).toBeNull();
    expect(localStorage.getItem('rk.staff')).toBeNull();

    localStorage.setItem('rk.staff', JSON.stringify({ id: kaan.id, token: 'x'.repeat(43) }));
    expect(await resumeStaffSession(db)).toBeNull();
  });

  it('does not let a signed-in token be moved to another person', async () => {
    await startStaffSession(db, ayse);
    const { token } = JSON.parse(localStorage.getItem('rk.staff') ?? '') as { token: string };
    localStorage.setItem('rk.staff', JSON.stringify({ id: kaan.id, token }));
    expect(await resumeStaffSession(db)).toBeNull();
    // And the session that was there is gone too: the next reload asks for a PIN.
    expect(await db.meta.get('staffSession')).toBeUndefined();
  });

  it('ends when the person’s PIN changes, here or on another register', async () => {
    await startStaffSession(db, ayse);
    await setStaffPin(db, ayse.id, '9999', at);
    expect(await resumeStaffSession(db)).toBeNull();
  });

  it('ends on sign-out, and is not found in another market’s database', async () => {
    await startStaffSession(db, ayse);
    const other = makeTestDb();
    try {
      expect(await resumeStaffSession(other)).toBeNull();
    } finally {
      await other.delete();
    }

    await startStaffSession(db, ayse);
    await endStaffSession(db);
    expect(localStorage.getItem('rk.staff')).toBeNull();
    expect(await resumeStaffSession(db)).toBeNull();
  });
});
