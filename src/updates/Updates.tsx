import { useState, type JSX } from 'react';
import { updateTarget, type UpdateTarget } from '@/settings/updates';
import { AndroidUpdateNotice } from './AndroidUpdateNotice';
import { DesktopReadyNotice } from './DesktopReadyNotice';
import { UpdateOverlay } from './UpdateOverlay';
import { androidWatch, webWatch } from './watches';
import { WebUpdateNotice } from './WebUpdateNotice';

/**
 * Word of a new release on each platform, over whatever screen shows: the desktop app's update
 * screen and its "program kapanınca kurulacak" notice, the Android app's download card, or the
 * web app's "Yenile". Mounted once, beside the app.
 */
export function Updates({ target }: { target?: UpdateTarget }): JSX.Element | null {
  const [where] = useState(() => target ?? updateTarget());
  if (where.desktop) {
    return (
      <>
        <UpdateOverlay desktop={where.desktop} />
        <DesktopReadyNotice desktop={where.desktop} />
      </>
    );
  }
  if (where.android) {
    return <AndroidUpdateNotice watch={androidWatch()} />;
  }
  if (where.web) {
    // Development serves no version.json; only a built app checks by itself.
    return <WebUpdateNotice watch={webWatch()} schedule={import.meta.env.PROD} />;
  }
  return null;
}
