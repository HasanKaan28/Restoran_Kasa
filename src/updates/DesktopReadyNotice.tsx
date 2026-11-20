import { useEffect, useState, type JSX } from 'react';
import { Button } from '@/design';
import type { DesktopUpdates, UpdateStatus } from '@/settings/updates';
import { UpdateNotice } from './UpdateNotice';
import { saveCheckedAt } from './updateTimes';
import { useDialogOpen } from './workGuard';

/** The updater's answers that mean a check came back. */
const ANSWERED: ReadonlySet<UpdateStatus['kind']> = new Set(['current', 'available', 'ready']);

/**
 * The desktop app's word that a release downloaded while the register was at work: it goes in
 * when the program closes, or now with "Şimdi yeniden başlat". It waits behind any open dialog.
 * It also notes when the updater last heard back, for Settings → Güncelleme.
 */
export function DesktopReadyNotice({
  desktop,
  now = Date.now,
}: {
  desktop: DesktopUpdates;
  now?: () => number;
}): JSX.Element {
  const [ready, setReady] = useState<string | null>(null);
  const [closed, setClosed] = useState<string | null>(null);
  const dialog = useDialogOpen();

  useEffect(
    () =>
      desktop.onStatus((status) => {
        if (ANSWERED.has(status.kind)) {
          saveCheckedAt(window.localStorage, now());
        }
        if (status.kind === 'ready') {
          setReady(status.version);
        } else if (status.kind === 'installing') {
          setReady(null);
        }
      }),
    [desktop, now],
  );

  return (
    <UpdateNotice
      compact
      open={ready !== null && ready !== closed && !dialog}
      title={`Yeni sürüm ${ready ?? ''} hazır`}
      detail="Program kapanınca kendiliğinden kurulacak."
      onClose={() => setClosed(ready)}
      actions={
        <Button variant="primary" className="max-sm:px-3" onClick={() => void desktop.install()}>
          Şimdi yeniden başlat
        </Button>
      }
    />
  );
}
