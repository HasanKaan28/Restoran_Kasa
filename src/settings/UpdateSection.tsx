import { useEffect, useState, type JSX, type ReactNode } from 'react';
import { Button } from '@/design';
import { useReleaseWatch, type ReleaseWatch } from '@/updates/releaseWatch';
import { PRIMARY_LINK } from '@/updates/UpdateNotice';
import { describeCheckedAt, loadCheckedAt, saveCheckedAt } from '@/updates/updateTimes';
import { androidWatch, webWatch } from '@/updates/watches';
import { reloadWhenIdle } from '@/updates/workGuard';
import { SettingsSection } from './MarketSections';
import { APK_URL, releaseNotesUrl, type DesktopUpdates, type UpdateStatus } from './updates';

export type { DesktopUpdates, UpdateStatus } from './updates';

const reloadPage = () => window.location.reload();

/**
 * Settings → Güncelleme on every platform: the version running, what the last check found and
 * when, "Denetle", the way to the new release and its notes. The desktop app hears its updater;
 * the Android and web apps share the watch their update notice reads (src/updates/watches.ts).
 */
export function UpdateSection({
  version,
  desktop,
  android = false,
  web = false,
  watch,
  reload = reloadPage,
}: {
  version: string;
  desktop?: DesktopUpdates;
  android?: boolean;
  web?: boolean;
  /** The release watch; by default the one the platform's notice reads. */
  watch?: ReleaseWatch;
  reload?: () => void;
}): JSX.Element | null {
  if (desktop) {
    return <DesktopUpdate version={version} desktop={desktop} />;
  }
  const shared = watch ?? (android ? androidWatch() : web ? webWatch() : undefined);
  if (!shared) {
    return null;
  }
  return <WatchedUpdate version={version} watch={shared} android={android} reload={reload} />;
}

const DESKTOP_LINES: Partial<Record<UpdateStatus['kind'], string>> = {
  checking: 'Denetleniyor…',
  current: 'Güncel',
  error: 'Güncelleme denetlenemedi.',
};

const ANSWERED: ReadonlySet<UpdateStatus['kind']> = new Set(['current', 'available', 'ready']);
const BUSY: ReadonlySet<UpdateStatus['kind']> = new Set(['checking', 'downloading', 'installing']);

function DesktopUpdate({
  version,
  desktop,
}: {
  version: string;
  desktop: DesktopUpdates;
}): JSX.Element {
  const [status, setStatus] = useState<UpdateStatus>();
  const [checkedAt, setCheckedAt] = useState(() => loadCheckedAt(window.localStorage));

  useEffect(() => {
    const stop = desktop.onStatus((next) => {
      setStatus(next);
      if (ANSWERED.has(next.kind)) {
        const at = Date.now();
        saveCheckedAt(window.localStorage, at);
        setCheckedAt(at);
      }
    });
    void desktop.check();
    return stop;
  }, [desktop]);

  const found = status?.kind === 'available' || status?.kind === 'ready' ? status.version : null;
  const line =
    status?.kind === 'downloading'
      ? `İndiriliyor %${status.percent}`
      : status?.kind === 'installing'
        ? 'Kuruluyor; uygulama yeniden açılacak.'
        : status?.kind === 'ready'
          ? `Sürüm ${status.version} indirildi; program kapanınca kendiliğinden kurulur.`
          : status?.kind === 'available'
            ? `Yeni sürüm ${status.version} hazır.`
            : status && DESKTOP_LINES[status.kind];

  return (
    <UpdateLayout
      version={version}
      line={line}
      checkedAt={checkedAt}
      found={found}
      checking={status !== undefined && BUSY.has(status.kind)}
      onCheck={() => void desktop.check()}
      primary={
        found ? (
          <Button variant="primary" onClick={() => void desktop.install()}>
            {status?.kind === 'ready' ? `Şimdi kur (${found})` : `Güncelle (${found})`}
          </Button>
        ) : null
      }
    />
  );
}

function WatchedUpdate({
  version,
  watch,
  android,
  reload,
}: {
  version: string;
  watch: ReleaseWatch;
  android: boolean;
  reload: () => void;
}): JSX.Element {
  const { checking, checkedAt, found, failed } = useReleaseWatch(watch);

  useEffect(() => {
    void watch.check();
  }, [watch]);

  const line = checking
    ? 'Denetleniyor…'
    : found
      ? android
        ? 'İndirilen dosyayı açıp kurun; verileriniz kalır.'
        : 'Yeni sürüm hazır; yenileyince açılır.'
      : failed
        ? 'Güncelleme denetlenemedi.'
        : checkedAt !== null
          ? 'Güncel'
          : undefined;

  return (
    <UpdateLayout
      version={version}
      line={line}
      checkedAt={checkedAt}
      found={found?.version ?? null}
      checking={checking}
      onCheck={() => void watch.check()}
      primary={
        !found ? null : android ? (
          <a href={APK_URL} target="_blank" rel="noreferrer" className={PRIMARY_LINK}>
            {`İndir ve kur (${found.version})`}
          </a>
        ) : (
          <Button variant="primary" onClick={() => reloadWhenIdle({ reload })}>
            Yenile
          </Button>
        )
      }
    />
  );
}

function UpdateLayout({
  version,
  line,
  checkedAt,
  found,
  checking,
  onCheck,
  primary,
}: {
  version: string;
  line: string | undefined;
  checkedAt: number | null;
  found: string | null;
  checking: boolean;
  onCheck(): void;
  primary: ReactNode;
}): JSX.Element {
  const now = useClock();
  return (
    <SettingsSection
      id="update-heading"
      title="Güncelleme"
      description={`Sürüm ${version}`}
      action={
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={checking} onClick={onCheck}>
            Denetle
          </Button>
          {primary}
        </div>
      }
    >
      {line ? (
        <p role="status" className="text-text-2">
          {line}
        </p>
      ) : null}
      <p className="flex flex-wrap items-center gap-x-2 text-meta text-muted">
        <span>{describeCheckedAt(checkedAt, now)}</span>
        <span aria-hidden="true">·</span>
        <a
          href={releaseNotesUrl(found ?? undefined)}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-accent underline-offset-4 hover:underline"
        >
          Neler yeni
        </a>
      </p>
    </SettingsSection>
  );
}

/** The time now, kept fresh enough for "bugün 14:05" to turn into "dün" on a register left open. */
function useClock(everyMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}
