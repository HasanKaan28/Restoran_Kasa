import { useLiveQuery } from 'dexie-react-hooks';
import { useState, type JSX } from 'react';
import { isSharedOrigin } from '@/admin/origin';
import { pendingCount } from '@/data/outbox';
import { Button, Dialog } from '@/design';
import { useData } from './appData';

/** Where the app lives now, apart from every other site. */
export const NEW_ADDRESS = 'https://restorankasa.vercel.app/app/';
const SHOWN_ADDRESS = 'restorankasa.vercel.app/app/';

/**
 * A register still running on hasankaan28.github.io, an address every GitHub Pages site of the
 * account shares (its storage, the register's session and database included). A line on top of
 * every screen says where the app lives now, and "Taşı" walks the move: nothing left to sync,
 * the owner signs in at the new address and takes this register's code over, then the new
 * address opens. Nothing is redirected by itself and nothing here is deleted.
 */
export function MoveBanner({
  hostname = window.location.hostname,
  go = (url: string) => window.location.assign(url),
  fresh = false,
}: {
  hostname?: string;
  /** A device not set up yet: nothing to move, so the button opens the new address. */
  fresh?: boolean;
  /** Opens an address; the browser's own by default. */
  go?: (url: string) => void;
}): JSX.Element | null {
  const [moving, setMoving] = useState(false);
  if (!isSharedOrigin(hostname)) {
    return null;
  }
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 bg-warning-bg px-4 py-1.5 text-sm text-warning md:px-6">
        <p role="status" className="py-1 font-medium">
          {`Uygulamanın yeni adresi: ${SHOWN_ADDRESS}`}
        </p>
        {fresh ? (
          <Button className="min-h-11" onClick={() => go(NEW_ADDRESS)}>
            Yeni adresi aç
          </Button>
        ) : (
          <Button className="min-h-11" onClick={() => setMoving(true)}>
            Taşı
          </Button>
        )}
      </div>
      {moving ? <MoveDialog go={go} onClose={() => setMoving(false)} /> : null}
    </>
  );
}

function MoveDialog({ go, onClose }: { go(url: string): void; onClose(): void }): JSX.Element {
  const { db, settings, runner } = useData();
  const waiting = useLiveQuery(() => pendingCount(db), [db]);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string>();
  const syncs = settings.paired === true;

  async function syncNow() {
    setSyncing(true);
    setError(undefined);
    const status = await runner.run();
    setSyncing(false);
    if (status.state === 'offline' || status.state === 'error') {
      setError(status.error ?? 'Eşitlenemedi. İnternet bağlantısını kontrol edip yeniden deneyin.');
    }
  }

  // A register that syncs leaves only once the server has everything done here.
  const ready = !syncs || waiting === 0;
  return (
    <Dialog
      open
      onOpenChange={(next) => !next && onClose()}
      title="Yeni adrese taşı"
      footer={
        <Button
          variant="primary"
          size="lg"
          disabled={!ready || syncing}
          onClick={() => go(NEW_ADDRESS)}
        >
          Yeni adresi aç
        </Button>
      }
    >
      <ol className="flex list-decimal flex-col gap-3 pl-5">
        {syncs ? (
          <li>
            <p>Bu adresteki her kayıt sunucuya gönderilmeli.</p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <p role="status" className="font-medium">
                {waiting === undefined
                  ? 'Bakılıyor…'
                  : waiting === 0
                    ? 'Bekleyen kayıt yok.'
                    : `${waiting} kayıt eşitlenmeyi bekliyor.`}
              </p>
              <Button disabled={syncing} onClick={() => void syncNow()}>
                Şimdi eşitle
              </Button>
            </div>
            {error ? (
              <p role="alert" className="mt-1 text-danger">
                {error}
              </p>
            ) : null}
          </li>
        ) : (
          <li>
            Bu cihaz sunucuyla eşitlenmiyor: kayıtları yeni adrese kendiliğinden geçmez. Ayarlar →
            Yedek’ten “Yedek al” ile bir kopyasını saklayın.
          </li>
        )}
        <li>
          Yeni adreste restoranın sahibi “Restorana giriş yap” ile kendi e-postası ve şifresiyle
          giriş yapar.
        </li>
        <li>
          {`Paketin cihaz sınırı doluysa listeden bu kasanın kodunu (${settings.deviceCode}) seçip “Yerine geç”e basın; yeni adres bu kasanın yerini alır.`}
        </li>
      </ol>
      <p className="mt-3 text-text-2">
        Bu adresteki kayıtlar silinmez. Yeni adres çalışınca bu sekmeyi kapatabilirsiniz.
      </p>
    </Dialog>
  );
}
