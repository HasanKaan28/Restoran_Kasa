import type { Summary } from '@/reports/summary';
import type { MarketDb } from './db';
import { RecordNotFoundError } from './errors';
import { newId } from './ids';
import { appendOutbox } from './outbox';
import { withoutUndefined } from './records';
import type { SavedReportRecord } from './types';

export type NewSavedReport = {
  title: string;
  /** Business days, YYYY-MM-DD, both ends included. */
  from: string;
  to: string;
  /** The register the report was limited to; absent for every register. */
  register?: string;
  summary: Summary;
  deviceCode: string;
  staffId?: string;
};

/** Keeps the figures of a period as they are now; they are never recomputed. */
export async function saveReport(
  db: MarketDb,
  input: NewSavedReport,
  at: Date,
): Promise<SavedReportRecord> {
  const title = input.title.trim();
  if (!title) {
    throw new RangeError('A saved report needs a title');
  }
  const stamp = at.toISOString();
  const record: SavedReportRecord = withoutUndefined({
    id: newId(at.getTime()),
    title,
    kind: 'period' as const,
    from: input.from,
    to: input.to,
    register: input.register || undefined,
    summary: input.summary,
    deviceCode: input.deviceCode,
    staffId: input.staffId,
    createdAt: stamp,
    updatedAt: stamp,
  });
  await db.transaction('rw', db.savedReports, db.outbox, async () => {
    await db.savedReports.add(record);
    await appendOutbox(
      db,
      { kind: 'insert', table: 'savedReports', recordId: record.id, record },
      at,
    );
  });
  return record;
}

/** The reports not archived, the newest first. */
export async function listSavedReports(db: MarketDb): Promise<SavedReportRecord[]> {
  const all = await db.savedReports.orderBy('createdAt').reverse().toArray();
  return all.filter((report) => !report.archivedAt);
}

/** Puts a report away; it stays on the device and in the sync, only out of the list. */
export async function archiveSavedReport(db: MarketDb, id: string, at: Date): Promise<void> {
  const stamp = at.toISOString();
  await db.transaction('rw', db.savedReports, db.outbox, async () => {
    const current = await db.savedReports.get(id);
    if (!current) {
      throw new RecordNotFoundError('SavedReport', id);
    }
    if (current.archivedAt) {
      return;
    }
    await db.savedReports.put({ ...current, archivedAt: stamp, updatedAt: stamp });
    await appendOutbox(
      db,
      {
        kind: 'patch',
        table: 'savedReports',
        recordId: id,
        patch: { archivedAt: stamp, updatedAt: stamp },
      },
      at,
    );
  });
}
