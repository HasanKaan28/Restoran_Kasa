import type { MarketDb } from './db';
import { RecordNotFoundError } from './errors';
import { appendOutbox } from './outbox';
import { toPatch } from './records';
import type { TabItemRecord } from './types';

/**
 * Hands the lines still being taken over at once (Teslim edildi: the bar poured the beer, the
 * waiter carried it): no kitchen or bar ticket, nothing waiting on the floor. Each line is stored
 * as one already made and served, sent, ready, served and delivered at the same moment, so a
 * v1.0.4 device reads it as a served line; the shared moment makes them one order for the order
 * slip. A line kept back for the next course stays. Returns how many went.
 */
export async function deliverTab(db: MarketDb, tabId: string, at: Date): Promise<number> {
  return db.transaction('rw', db.tabs, db.tabItems, db.outbox, async () => {
    const tab = await db.tabs.get(tabId);
    if (!tab) {
      throw new RecordNotFoundError('Tab', tabId);
    }
    if (tab.status !== 'open') {
      throw new RangeError('This tab is closed');
    }
    const stamp = at.toISOString();
    const taking = (await db.tabItems.where('tabId').equals(tabId).toArray()).filter(
      (item) => item.status === 'new' && !item.hold,
    );
    for (const item of taking) {
      await handOver(db, item, stamp, at);
    }
    return taking.length;
  });
}

async function handOver(db: MarketDb, item: TabItemRecord, stamp: string, at: Date): Promise<void> {
  const changes = {
    status: 'ready',
    sentAt: stamp,
    readyAt: stamp,
    servedAt: stamp,
    deliveredAt: stamp,
  } as const;
  await db.tabItems.put({ ...item, ...changes, updatedAt: stamp });
  await appendOutbox(
    db,
    { kind: 'patch', table: 'tabItems', recordId: item.id, patch: toPatch(changes, stamp) },
    at,
  );
}
