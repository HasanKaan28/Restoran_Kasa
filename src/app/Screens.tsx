import type { JSX } from 'react';
import { KitchenScreen } from '@/restaurant/KitchenScreen';
import { TablesScreen } from '@/restaurant/TablesScreen';
import { TillOpenPrompt } from '@/restaurant/TillOpenPrompt';
import { ProductsScreen } from '@/products/ProductsScreen';
import { ReportsScreen } from '@/reports/ReportsScreen';
import { DeviceSettingsScreen, SettingsScreen } from '@/settings/SettingsScreen';
import { useData, useSyncStatus } from './appData';
import { AppShell } from './AppShell';
import { ROUTE_PERMISSIONS, type Route } from './route';
import { useSession } from './session';

/** The screen an address names, if the person signed in may open it. */
export function Screens({ route }: { route: Route }): JSX.Element {
  const session = useSession();
  const needed = ROUTE_PERMISSIONS[route];
  if (needed !== undefined && !session.can(needed)) {
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
    case 'reports':
      return <ReportsScreen />;
    case 'settings':
      return <SettingsScreen />;
  }
}

/** What a screen shows a person not allowed to use it, as when they type its address. */
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
      <p className="rounded-control border border-line bg-surface p-5 text-text-2">
        Bu ekran için yetkiniz yok.
      </p>
    </AppShell>
  );
}
