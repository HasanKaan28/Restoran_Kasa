import type { JSX } from 'react';
import { KitchenScreen } from '@/restaurant/KitchenScreen';
import { TablesScreen } from '@/restaurant/TablesScreen';
import { TillOpenPrompt } from '@/restaurant/TillOpenPrompt';
import { ManageScreen } from '@/manage/ManageScreen';
import { ProductsScreen } from '@/products/ProductsScreen';
import { DeviceSettingsScreen, SettingsScreen } from '@/settings/SettingsScreen';
import { useData, useSyncStatus } from './appData';
import { AppShell } from './AppShell';
import { NoAccessNote } from './NoAccessNote';
import { canOpenRoute, type Route } from './route';
import { useSession } from './session';

/** The screen an address names, if the person signed in may open it. */
export function Screens({ route }: { route: Route }): JSX.Element {
  const session = useSession();
  if (!canOpenRoute(route, session.can)) {
    // Everyone may set this device's own notices and screen.
    return route === 'settings' ? <DeviceSettingsScreen /> : <NoAccess route={route} />;
  }
  switch (route) {
    case 'tables':
      // The floor is where the day starts: a till not yet open is asked for there.
      return (
        <>
          <TablesScreen />
          <TillOpenPrompt />
        </>
      );
    case 'kitchen':
      return <KitchenScreen />;
    case 'products':
      return <ProductsScreen />;
    case 'manage':
      return <ManageScreen />;
    case 'settings':
      return <SettingsScreen />;
  }
}

/** A screen the person signed in may not open, in the frame of the app. */
function NoAccess({ route }: { route: Route }): JSX.Element {
  const { settings, runner } = useData();
  const status = useSyncStatus(runner);
  return (
    <AppShell
      marketName={settings.marketName}
      deviceName={settings.deviceName}
      syncState={status.state}
      pendingCount={status.pendingCount}
      syncError={status.error}
      activeNav={route}
    >
      <NoAccessNote />
    </AppShell>
  );
}
