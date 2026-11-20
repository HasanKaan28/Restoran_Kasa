import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestDb } from '@/test/db';
import {
  dismissAnnouncement,
  loadAnnouncements,
  loadDismissedAnnouncements,
  saveServerAnnouncements,
} from './announcements';
import type { MarketDb } from './db';

let db: MarketDb;
beforeEach(() => {
  db = makeTestDb();
});
afterEach(async () => {
  await db.delete();
});

const one = { id: 'a1', message: 'Yarın bakım var.', createdAt: '2026-11-27T09:00:00Z' };

describe('the seller’s announcements on a register', () => {
  it('keeps the list the server sent, replacing the last one', async () => {
    expect(await loadAnnouncements(db)).toEqual([]);
    await saveServerAnnouncements(db, [{ ...one, expiresAt: null }]);
    expect(await loadAnnouncements(db)).toEqual([one]);
    await saveServerAnnouncements(db, []);
    expect(await loadAnnouncements(db)).toEqual([]);
  });

  it('ignores an answer of the wrong shape and drops malformed items', async () => {
    await saveServerAnnouncements(db, [one]);
    await saveServerAnnouncements(db, undefined);
    await saveServerAnnouncements(db, { id: 'x' });
    expect(await loadAnnouncements(db)).toEqual([one]);
    await saveServerAnnouncements(db, [one, { id: 'b', message: '  ' }, null, { id: 3 }]);
    expect(await loadAnnouncements(db)).toEqual([one]);
  });

  it('remembers which ones were closed here', async () => {
    await dismissAnnouncement(db, 'a1');
    await dismissAnnouncement(db, 'a1');
    await dismissAnnouncement(db, 'b2');
    expect(await loadDismissedAnnouncements(db)).toEqual(['a1', 'b2']);
  });
});
