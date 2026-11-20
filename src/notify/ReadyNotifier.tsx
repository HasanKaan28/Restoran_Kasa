import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState, useSyncExternalStore, type JSX } from 'react';
import { useData } from '@/app/appData';
import { openTabScreen, type Route } from '@/app/route';
import { useSession } from '@/app/session';
import { buzz, playChime, unlockChime } from './chime';
import { notifyPrefsSnapshot, subscribeNotifyPrefs, type NotifyPrefs } from './prefs';
import { ReadyBanner } from './ReadyBanner';
import { noticeText, takeReadyNews, type Listener, type ReadyNotice } from './readyNotices';
import { listenForNoticeTaps, showSystemNotice } from './system';

/** Lines marked ready within this of each other are told as one notice. */
const GROUP_MS = 2_000;
/** A notice nobody tapped goes away after this; the floor still shows the table as ready. */
const SHOW_MS = 30_000;
/** At most this many notices at once; older ones give way to new ones. */
const MOST = 3;

/** What Settings → Bildirimler → "Dene" sends; the notifier answers with a sample notice. */
export const TRY_NOTICE_EVENT = 'rk-try-ready-notice';

const SAMPLE: ReadyNotice = {
  id: 'sample',
  tabId: '',
  title: 'Masa 5',
  station: 'kitchen',
  lines: [
    { label: 'Adana kebap', qtyMilli: 2000, unit: 'piece' },
    { label: 'Ayran', qtyMilli: 1000, unit: 'piece' },
  ],
  itemIds: [],
};

/**
 * Tells this device's waiter when the kitchen or the bar has made their order ready: a banner, a
 * short sound, a buzz and the device's own notification, as Settings → Bildirimler says. It looks
 * whenever the ready lines change (a sync brought the kitchen's "ready") and waits a moment so
 * lines marked together are told together. A kitchen or bar screen never tells itself anything.
 */
export function ReadyNotifier({
  route,
  groupMs = GROUP_MS,
}: {
  route: Route;
  groupMs?: number;
}): JSX.Element {
  const { db, settings } = useData();
  const session = useSession();
  const prefs = useSyncExternalStore(subscribeNotifyPrefs, notifyPrefsSnapshot);
  const [notices, setNotices] = useState<ReadyNotice[]>([]);
  // Changes whenever a line becomes ready, or ready again after a recall.
  const readyNow = useLiveQuery(
    async () =>
      (await db.tabItems.where('status').equals('ready').toArray())
        .map((item) => `${item.id}@${item.readyAt ?? ''}`)
        .join(','),
    [db],
  );

  const me: Listener = { deviceCode: settings.deviceCode, staffId: session.staff?.id ?? null };
  const quiet = route === 'kitchen' || !prefs.enabled;
  // What the next look uses: who is signed in, the choices and the screen as they are then.
  const latest = useRef({ me, prefs, quiet });
  useEffect(() => {
    latest.current = { me, prefs, quiet };
  });

  const deliver = useRef((news: ReadyNotice[], chosen: NotifyPrefs) => {
    setNotices((shown) => [...news.slice().reverse(), ...shown].slice(0, MOST));
    if (chosen.sound) {
      playChime();
    }
    if (chosen.vibrate) {
      buzz();
    }
    for (const notice of news) {
      const { title, body } = noticeText(notice);
      void showSystemNotice({ id: notice.id, title, body, tabId: notice.tabId }, openTab);
    }
  });

  useEffect(() => {
    if (readyNow === undefined) {
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      const { me: listener, prefs: chosen, quiet } = latest.current;
      takeReadyNews(db, listener, { scope: chosen.scope, quiet, now: new Date() }).then(
        (news) => {
          if (live && news.length > 0) {
            deliver.current(news, chosen);
          }
        },
        (error: unknown) => console.error('Hazır bildirimi okunamadı', error),
      );
    }, groupMs);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [db, readyNow, groupMs]);

  // Each notice leaves on its own after a while.
  useEffect(() => {
    if (notices.length === 0) {
      return;
    }
    const timer = setTimeout(() => setNotices((shown) => shown.slice(0, -1)), SHOW_MS);
    return () => clearTimeout(timer);
  }, [notices]);

  useEffect(() => {
    const tryIt = () =>
      deliver.current([{ ...SAMPLE, id: `sample-${Date.now()}` }], latest.current.prefs);
    window.addEventListener(TRY_NOTICE_EVENT, tryIt);
    window.addEventListener('pointerdown', unlockChime, { once: true });
    const stopTaps = listenForNoticeTaps(openTab);
    return () => {
      window.removeEventListener(TRY_NOTICE_EVENT, tryIt);
      window.removeEventListener('pointerdown', unlockChime);
      stopTaps();
    };
  }, []);

  return (
    <ReadyBanner
      notices={notices}
      onOpen={(notice) => {
        setNotices((shown) => shown.filter((other) => other.id !== notice.id));
        openTab(notice.tabId);
      }}
      onDismiss={(id) => setNotices((shown) => shown.filter((other) => other.id !== id))}
    />
  );
}

/** The sample notice has no tab: tapping it only puts it away. */
function openTab(tabId: string): void {
  if (tabId !== '') {
    openTabScreen(tabId);
  }
}
