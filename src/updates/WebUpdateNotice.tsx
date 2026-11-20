import { RotateCw } from 'lucide-react';
import { useEffect, useState, type JSX } from 'react';
import { Button } from '@/design';
import { useReleaseWatch, type ReleaseWatch } from './releaseWatch';
import { useScheduledChecks } from './schedule';
import { UpdateNotice } from './UpdateNotice';
import { reloadWhenIdle, useDialogOpen, workInProgress } from './workGuard';

const reloadPage = () => window.location.reload();

/**
 * The web app's "Yeni sürüm hazır · Yenile". The page compares its build with version.json every
 * few hours and when it comes back to the front (src/updates/schedule.ts). "Yenile" reloads at
 * once on a quiet screen; with an order unsent, a dialog open or a field being typed in, it waits
 * until that is over, so nothing is cut short. The service worker serves the new build on reload.
 */
export function WebUpdateNotice({
  watch,
  schedule = true,
  reload = reloadPage,
  isBusy = workInProgress,
}: {
  watch: ReleaseWatch;
  /** Off in development, where there is no version.json, and in tests. */
  schedule?: boolean;
  reload?: () => void;
  isBusy?: () => boolean;
}): JSX.Element {
  useScheduledChecks(watch, { checkOnStart: 'when-due', enabled: schedule });
  const { found } = useReleaseWatch(watch);
  const dialog = useDialogOpen();
  const [closed, setClosed] = useState(false);
  const [waiting, setWaiting] = useState(false);

  useEffect(
    () => (waiting ? reloadWhenIdle({ isBusy, reload }) : undefined),
    [waiting, isBusy, reload],
  );

  return (
    <UpdateNotice
      compact
      open={found !== null && !closed && !dialog}
      title="Yeni sürüm hazır"
      {...(waiting ? { detail: 'Elinizdeki iş bitince yenilenecek.' } : {})}
      onClose={() => {
        setClosed(true);
        setWaiting(false);
      }}
      actions={
        waiting ? null : (
          <Button
            variant="primary"
            icon={<RotateCw aria-hidden="true" size={16} strokeWidth={2} />}
            onClick={() => (isBusy() ? setWaiting(true) : reload())}
          >
            Yenile
          </Button>
        )
      }
    />
  );
}
