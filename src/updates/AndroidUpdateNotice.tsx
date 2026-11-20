import { Download } from 'lucide-react';
import { useState, type JSX } from 'react';
import { Button } from '@/design';
import { APK_URL } from '@/settings/updates';
import { useReleaseWatch, type ReleaseWatch } from './releaseWatch';
import { useScheduledChecks } from './schedule';
import { PRIMARY_LINK, UpdateNotice } from './UpdateNotice';
import { isSnoozed, snoozeRelease } from './updateTimes';
import { useDialogOpen } from './workGuard';

/**
 * The Android app's "Yeni sürüm hazır" card. The app looks for a newer GitHub release when it
 * starts and every few hours (src/updates/schedule.ts); a newer one is offered under the header,
 * never during an open dialog. "İndir ve kur" opens the APK in the browser (installing it from
 * inside the app would take a native plugin) and explains the one-time "Bu kaynaktan izin ver"
 * step; "Sonra" keeps that release quiet on this phone for a day.
 */
export function AndroidUpdateNotice({
  watch,
  schedule = true,
  now = Date.now,
}: {
  watch: ReleaseWatch;
  /** Off in tests that hand in a watch that has already checked. */
  schedule?: boolean;
  now?: () => number;
}): JSX.Element {
  useScheduledChecks(watch, { checkOnStart: 'always', enabled: schedule });
  const { found } = useReleaseWatch(watch);
  const dialog = useDialogOpen();
  const [step, setStep] = useState<'offer' | 'hint'>('offer');
  const [, setPutOff] = useState(0);

  const version = found?.version;
  const open = version !== undefined && !dialog && !isSnoozed(localStorage, version, now());
  const putOff = () => {
    if (version) {
      snoozeRelease(localStorage, version, now());
    }
    setStep('offer');
    setPutOff((count) => count + 1);
  };

  if (step === 'hint') {
    return (
      <UpdateNotice
        open={open}
        title="Kurulum için son adım"
        detail="İndirme bitince:"
        onClose={putOff}
        actions={<Button onClick={putOff}>Tamam</Button>}
      >
        <InstallHint />
      </UpdateNotice>
    );
  }
  return (
    <UpdateNotice
      open={open}
      title={`Yeni sürüm ${version ?? ''} hazır`}
      detail="Verileriniz telefonda kalır; kurulum bir dakika sürer."
      onClose={putOff}
      actions={
        <>
          <Button variant="ghost" onClick={putOff}>
            Sonra
          </Button>
          <a
            href={APK_URL}
            target="_blank"
            rel="noreferrer"
            className={PRIMARY_LINK}
            onClick={() => setStep('hint')}
          >
            <Download aria-hidden="true" size={18} strokeWidth={2} />
            İndir ve kur
          </a>
        </>
      }
    />
  );
}

/** The phone's own question, drawn small, and the three taps that follow. */
function InstallHint(): JSX.Element {
  return (
    <div className="mt-3 flex flex-col gap-3">
      <div
        aria-hidden="true"
        className="flex items-center gap-3 rounded-control border border-line bg-bg p-2.5"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-control bg-surface text-text-2">
          <Download size={16} strokeWidth={2} />
        </span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block text-meta font-semibold">Bilinmeyen uygulamaları yükle</span>
          <span className="block text-meta text-text-2">Bu kaynaktan izin ver</span>
        </span>
        <span className="update-switch shrink-0" />
      </div>
      <ol className="flex list-decimal flex-col gap-1 pl-5 text-meta text-text-2 marker:font-semibold marker:text-text">
        <li>
          Bildirimden ya da İndirilenler’den{' '}
          <b className="whitespace-nowrap text-text">Restoran-Kasa.apk</b> dosyasına dokunun.
        </li>
        <li>
          Android ilk seferde sorarsa <b className="text-text">Bu kaynaktan izin ver</b> anahtarını
          açıp geri dönün.
        </li>
        <li>
          <b className="text-text">Güncelle</b>’ye dokunun; verileriniz yerinde kalır.
        </li>
      </ol>
    </div>
  );
}
