import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState, type JSX, type ReactNode } from 'react';
import type { MarketDb } from '@/data/db';
import { listStaff } from '@/data/staff';
import { can } from '@/domain/permissions';
import { useData } from './appData';
import { SessionContext, type Session } from './session';
import { SignInScreen } from './SignInScreen';
import { endStaffSession, resumeStaffSession, startStaffSession } from './staffSession';

/** Who is signed in on a market's database; the database says whose answer it is. */
type Signed = { db: MarketDb; staffId: string | null };

/**
 * Runs the app as the person signed in on this register. While staff are set up and nobody is
 * signed in, or the person signed in has been archived (here or on another device), it shows the
 * sign-in screen instead; with no staff set up it lets everyone in. Until it knows which, it shows
 * nothing, so no screen flashes past the sign-in. A session is resumed after a reload only when it
 * was started by a sign-in on this register (staffSession.ts).
 */
export function SessionProvider({ children }: { children: ReactNode }): JSX.Element | null {
  const { db } = useData();
  const people = useLiveQuery(() => listStaff(db, { active: true }), [db]);
  const [signed, setSigned] = useState<Signed>();
  // Undefined while the session kept on this register is still being checked.
  const staffId = signed?.db === db ? signed.staffId : undefined;

  useEffect(() => {
    let live = true;
    resumeStaffSession(db).then(
      (resumed) => live && setSigned({ db, staffId: resumed }),
      () => live && setSigned({ db, staffId: null }),
    );
    return () => {
      live = false;
    };
  }, [db]);

  const session = useMemo<Session | null>(() => {
    if (people === undefined || staffId === undefined) {
      return null;
    }
    const open = people.length === 0;
    const staff = open ? null : (people.find((person) => person.id === staffId) ?? null);
    return {
      staff,
      open,
      can: (permission) => open || (staff !== null && can(staff, permission)),
      signIn: (person) => {
        setSigned({ db, staffId: person.id });
        // Kept for a reload; should that fail, the session lasts until the page is closed.
        startStaffSession(db, person).catch(() => {});
      },
      signOut: () => {
        setSigned({ db, staffId: null });
        endStaffSession(db).catch(() => {});
      },
    };
  }, [db, people, staffId]);

  // A person no longer among the active staff is shown the sign-in at once (session.staff is
  // null) and forgotten by this device, so a reload does not bring them back.
  const gone = session !== null && !session.open && staffId != null && session.staff === null;
  useEffect(() => {
    if (gone) {
      endStaffSession(db).catch(() => {});
    }
  }, [db, gone]);

  if (session === null) {
    return null;
  }
  return (
    <SessionContext value={session}>
      {session.open || session.staff ? (
        children
      ) : (
        <SignInScreen people={people ?? []} onSignedIn={session.signIn} />
      )}
    </SessionContext>
  );
}
