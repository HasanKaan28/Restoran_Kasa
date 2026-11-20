import { useEffect, useState, type JSX } from 'react';
import { clearStoredCarts } from '@/pos/held';
import { createAppData } from './appData';
import { DataProvider } from './DataProvider';
import { ErrorBoundary } from './ErrorBoundary';
import { loadDeviceSettings } from './device';
import { MoveBanner } from './MoveBanner';
import { finishPairing } from './finishPairing';
import { Screens } from './Screens';
import { SessionProvider } from './SessionProvider';
import { keepSyncing } from './syncSchedule';
import { useRoute } from './route';
import { deviceClient, ownerClient } from '@/server/client';
import { SERVER } from '@/server/config';
import { joinMarket, openMarket } from '@/server/onboarding';
import { currentPlatform, pairDevice } from '@/server/pairing';
import { forgetSkippedWelcome, shouldWelcome } from './welcome';
import { ServerMissingScreen, WelcomeScreen } from './WelcomeScreen';
import { Updates } from '@/updates/Updates';
import { ReadyNotifier } from '@/notify/ReadyNotifier';

/** The app, with word of a new release (and the desktop's update screen) over whatever shows. */
export function App(): JSX.Element {
  return (
    <>
      <AppContent />
      <Updates />
    </>
  );
}

function AppContent(): JSX.Element {
  const [data] = useState(() => createAppData(loadDeviceSettings()));
  const welcome = shouldWelcome(data.settings);
  const route = useRoute();

  useEffect(() => {
    forgetSkippedWelcome(window.localStorage);
  }, []);

  useEffect(() => {
    void data.runner.run();
    return keepSyncing(data.runner);
  }, [data]);

  const server = SERVER;
  if (welcome && !server) {
    return <ServerMissingScreen />;
  }
  if (welcome && server) {
    const platform = currentPlatform();
    return (
      <>
        <MoveBanner fresh />
        <WelcomeScreen
          current={data.settings}
          open={(input) =>
            openMarket({
              owner: ownerClient(server),
              device: deviceClient(server),
              platform,
              ...input,
            })
          }
          join={(input) =>
            joinMarket({
              owner: ownerClient(server),
              device: deviceClient(server),
              platform,
              ...input,
            })
          }
          claim={(input) => pairDevice({ device: deviceClient(server), platform, ...input })}
          onDone={(next) => {
            if (finishPairing(next)) {
              window.location.reload();
            }
          }}
        />
      </>
    );
  }

  return (
    <ErrorBoundary {...(route === 'tables' ? RESTART : LEAVE_SCREEN)}>
      <DataProvider value={data}>
        {/* Above the session: a locked register shows it too. */}
        <MoveBanner />
        <SessionProvider>
          <Screens route={route} />
          <ReadyNotifier route={route} />
        </SessionProvider>
      </DataProvider>
    </ErrorBoundary>
  );
}

/** The way out of a crash: a stored cart that cannot be shown is the usual cause. */
function resetRegister(): void {
  clearStoredCarts();
  window.location.reload();
}

// On the floor itself: start again, the market's held carts (which the restaurant never fills)
// cleared on the way, said as the restaurant says it.
const RESTART = {
  message: 'Kaydedilen siparişler ve satışlar güvende. Uygulamayı yeniden başlatın.',
  resetLabel: 'Yeniden başlat',
  onReset: resetRegister,
};

// A crash on another screen has nothing to do with the carts: keep them and go back to the
// floor, which a reload of the crashed screen would never reach.
const LEAVE_SCREEN = {
  message: 'Kaydedilen siparişler ve satışlar güvende. Masalara dönüp devam edebilirsiniz.',
  resetLabel: 'Masalara dön',
  onReset: () => {
    window.location.hash = '#/tables';
    window.location.reload();
  },
};
