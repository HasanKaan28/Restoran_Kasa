import { useLiveQuery } from 'dexie-react-hooks';
import { useContext } from 'react';
import { loadLicense } from '@/data/license';
import { loadMarketSettings } from '@/data/settings';
import { licenseState, type LicenseState } from '@/domain/license';
import { DataContext } from './appData';

// The licence is kept with the market's data, where the sync engine writes what the server says.
export { loadLicense, saveLicense } from '@/data/license';

const UNKNOWN: LicenseState = { kind: 'unknown' };

/**
 * Where the licence stands today. Outside the app's data, as when the shell is shown on its own,
 * nothing is known, and nothing is restricted.
 */
export function useLicense(): LicenseState {
  const data = useContext(DataContext);
  // The day turns at the market's cutoff, read here too, so the shell needs no other provider.
  const known = useLiveQuery(async () => {
    if (!data) {
      return { expiresAt: null, cutoffMinutes: 0 };
    }
    const [expiresAt, settings] = await Promise.all([
      loadLicense(data.db),
      loadMarketSettings(data.db),
    ]);
    return { expiresAt, cutoffMinutes: settings.cutoffMinutes };
  }, [data]);
  return known === undefined
    ? UNKNOWN
    : licenseState(known.expiresAt, new Date(), { cutoffMinutes: known.cutoffMinutes });
}
