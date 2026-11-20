import type { MarketDb } from './db';

const KEY = 'announcements';
const DISMISSED_KEY = 'announcementsDismissed';

/** At most this many are kept, as the server sends at most five. */
const MAX_KEPT = 5;
/** Dismissed ids remembered; older ones belong to announcements long gone. */
const MAX_DISMISSED = 50;

/** A message from the seller for this restaurant's registers, as the server sends it on a pull. */
export type Announcement = { id: string; message: string; createdAt: string };

/** The seller's live announcements as last heard from the server, newest first. */
export async function loadAnnouncements(db: MarketDb): Promise<Announcement[]> {
  const value = (await db.meta.get(KEY))?.value;
  return Array.isArray(value) ? value.filter(isAnnouncement) : [];
}

/**
 * Keeps what the server said: the list replaces the last one, so an announcement the seller took
 * down disappears. An answer of the wrong shape changes nothing; malformed items are dropped.
 */
export async function saveServerAnnouncements(db: MarketDb, value: unknown): Promise<void> {
  if (!Array.isArray(value)) {
    return;
  }
  const kept = value
    .filter(isAnnouncement)
    .slice(0, MAX_KEPT)
    .map(({ id, message, createdAt }) => ({
      id,
      message: message.slice(0, 280),
      createdAt,
    }));
  await db.meta.put({ key: KEY, value: kept });
}

/** The announcements this register's user closed; they stay closed here. */
export async function loadDismissedAnnouncements(db: MarketDb): Promise<string[]> {
  const value = (await db.meta.get(DISMISSED_KEY))?.value;
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
}

export async function dismissAnnouncement(db: MarketDb, id: string): Promise<void> {
  await db.transaction('rw', db.meta, async () => {
    const dismissed = await loadDismissedAnnouncements(db);
    if (!dismissed.includes(id)) {
      await db.meta.put({
        key: DISMISSED_KEY,
        value: [...dismissed, id].slice(-MAX_DISMISSED),
      });
    }
  });
}

function isAnnouncement(value: unknown): value is Announcement {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const { id, message, createdAt } = value as Record<string, unknown>;
  return (
    typeof id === 'string' &&
    id.length > 0 &&
    typeof message === 'string' &&
    message.trim().length > 0 &&
    typeof createdAt === 'string'
  );
}
