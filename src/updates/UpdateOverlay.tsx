import { useEffect, useState, type JSX } from 'react';
import { useMediaQuery } from '@/design';
import type { DesktopUpdates, UpdateStatus } from '@/settings/updates';
import { UpdateMark } from './UpdateMark';

type Shown =
  | { kind: 'downloading'; version?: string; percent: number }
  | { kind: 'installing'; version: string };

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

/**
 * The desktop app's "Güncelleniyor" screen: over everything while an update found at start
 * downloads, since the app will close and reopen when it is done. It cannot be put off. The mark
 * prints itself as the download runs and settles with a tick once it is in; with reduced motion
 * it stays still and a plain bar shows the progress.
 */
export function UpdateOverlay({ desktop }: { desktop?: DesktopUpdates }): JSX.Element | null {
  const [shown, setShown] = useState<Shown | null>(null);
  const still = useMediaQuery(REDUCED_MOTION);

  useEffect(() => {
    if (!desktop) {
      return;
    }
    return desktop.onStatus((status: UpdateStatus) => {
      setShown((current) => {
        switch (status.kind) {
          case 'available':
            return status.installNow
              ? { kind: 'downloading', version: status.version, percent: 0 }
              : null;
          case 'downloading': {
            const version = status.version ?? current?.version;
            return status.installNow
              ? { kind: 'downloading', percent: status.percent, ...(version ? { version } : {}) }
              : null;
          }
          case 'installing':
            return { kind: 'installing', version: status.version };
          default:
            return null;
        }
      });
    });
  }, [desktop]);

  if (!desktop || !shown) {
    return null;
  }

  const installing = shown.kind === 'installing';
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="update-overlay-title"
      aria-describedby="update-overlay-note"
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-bg px-4 py-10"
    >
      <div className="flex w-full max-w-sm animate-pop-in flex-col items-center text-center">
        <UpdateMark
          className="size-36 sm:size-40"
          progress={installing ? 100 : shown.percent}
          done={installing}
          still={still}
        />
        <h1
          id="update-overlay-title"
          className="mt-9 font-display text-title font-semibold tracking-[-0.02em]"
        >
          {installing ? 'Kuruluyor' : 'Güncelleniyor'}
        </h1>
        <p className="mt-2 text-body text-text-2">
          {installing
            ? `Sürüm ${shown.version} indirildi`
            : shown.version
              ? `Sürüm ${shown.version} indiriliyor`
              : 'Yeni sürüm indiriliyor'}
        </p>
        {shown.kind === 'downloading' ? <Progress percent={shown.percent} bar={still} /> : null}
        <p id="update-overlay-note" className="mt-7 max-w-[19rem] text-meta text-muted">
          {installing
            ? 'Program kapanıp yeni sürümle kendiliğinden açılacak. Bilgisayarı kapatmayın.'
            : 'Verileriniz cihazda güvende; birazdan kendiliğinden açılacak.'}
        </p>
      </div>
    </div>
  );
}

/** The percentage in big figures; with reduced motion a plain bar under it does the moving. */
function Progress({ percent, bar }: { percent: number; bar: boolean }): JSX.Element {
  return (
    <div
      role="progressbar"
      aria-label="İndirme"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className="mt-5 flex w-full max-w-60 flex-col items-center gap-3"
    >
      <span className="font-display text-figure font-semibold tracking-[-0.02em] tabular-nums">
        {`%${percent}`}
      </span>
      {bar ? (
        <span className="h-1.5 w-full overflow-hidden rounded-chip bg-line">
          <span data-bar className="block h-full bg-accent" style={{ width: `${percent}%` }} />
        </span>
      ) : null}
    </div>
  );
}
