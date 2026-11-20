import { startStaffSession } from '@/app/staffSession';
import type { MarketDb } from '@/data/db';

/** Signs a person in on the test register, as their right PIN on the sign-in screen does. */
export async function signInAs(db: MarketDb, staffId: string): Promise<void> {
  const staff = await db.staff.get(staffId);
  if (!staff) {
    throw new Error(`No staff ${staffId}`);
  }
  await startStaffSession(db, staff);
}
