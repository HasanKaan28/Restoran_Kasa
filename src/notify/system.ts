import { Capacitor } from '@capacitor/core';

/**
 * The phone's or computer's own notification, beside the in-app banner: on Android through the
 * local-notifications plugin, in a browser, an installed web app and the desktop (Electron) through
 * the web's Notification API. It shows while the app is open or in the background; a locked phone
 * whose app has been put to sleep needs a push from the server (docs: push-notifications-plan).
 */
export type SystemPermission = 'granted' | 'denied' | 'default' | 'unsupported';

export type SystemNotice = { id: string; title: string; body: string; tabId: string };

const ICON = './icon-192.png';

function native(): boolean {
  return Capacitor.isNativePlatform();
}

async function plugin() {
  return (await import('@capacitor/local-notifications')).LocalNotifications;
}

function webNotifications(): typeof Notification | undefined {
  return typeof window !== 'undefined' && 'Notification' in window
    ? window.Notification
    : undefined;
}

/** Whether this device may show notifications now, without asking. */
export async function systemPermission(): Promise<SystemPermission> {
  try {
    if (native()) {
      const { display } = await (await plugin()).checkPermissions();
      return display === 'granted' || display === 'denied' ? display : 'default';
    }
    return webNotifications()?.permission ?? 'unsupported';
  } catch {
    return 'unsupported';
  }
}

/** Asks the person; only ever from the Bildirimler setting, after it has said why. */
export async function askSystemPermission(): Promise<SystemPermission> {
  try {
    if (native()) {
      const { display } = await (await plugin()).requestPermissions();
      return display === 'granted' || display === 'denied' ? display : 'default';
    }
    const api = webNotifications();
    return api ? await api.requestPermission() : 'unsupported';
  } catch {
    return 'unsupported';
  }
}

/** Shows the notice when allowed; does nothing otherwise, and never asks. */
export async function showSystemNotice(
  notice: SystemNotice,
  onOpen: (tabId: string) => void,
): Promise<void> {
  if ((await systemPermission()) !== 'granted') {
    return;
  }
  try {
    if (native()) {
      await (
        await plugin()
      ).schedule({
        notifications: [
          { id: numericId(notice.id), title: notice.title, body: notice.body, extra: notice },
        ],
      });
      return;
    }
    const options: NotificationOptions = {
      body: notice.body,
      tag: notice.id,
      icon: ICON,
      data: { tabId: notice.tabId },
    };
    // Android's Chrome shows notifications only through the service worker; elsewhere a plain
    // notification is enough and its click comes straight back here.
    const worker = await navigator.serviceWorker?.getRegistration?.();
    if (worker) {
      await worker.showNotification(notice.title, options);
      return;
    }
    const api = webNotifications();
    if (api) {
      const shown = new api(notice.title, options);
      shown.onclick = () => {
        window.focus();
        onOpen(notice.tabId);
        shown.close();
      };
    }
  } catch {
    // The banner on the screen still says it.
  }
}

/**
 * Opens the tab a tapped notification names: the Android plugin's tap, or the service worker's
 * message after it brought the app forward. Returns what stops listening.
 */
export function listenForNoticeTaps(onOpen: (tabId: string) => void): () => void {
  const fromWorker = (event: MessageEvent) => {
    const data = event.data as { type?: unknown; tabId?: unknown } | null;
    if (data?.type === 'rk-open-tab' && typeof data.tabId === 'string') {
      onOpen(data.tabId);
    }
  };
  navigator.serviceWorker?.addEventListener?.('message', fromWorker);
  let stopNative: (() => void) | undefined;
  let stopped = false;
  if (native()) {
    void plugin()
      .then((api) =>
        api.addListener('localNotificationActionPerformed', ({ notification }) => {
          const tabId = (notification.extra as { tabId?: unknown } | undefined)?.tabId;
          if (typeof tabId === 'string') {
            onOpen(tabId);
          }
        }),
      )
      .then((handle) => {
        stopNative = () => void handle.remove();
        if (stopped) {
          stopNative();
        }
      })
      .catch(() => undefined);
  }
  return () => {
    stopped = true;
    navigator.serviceWorker?.removeEventListener?.('message', fromWorker);
    stopNative?.();
  };
}

/** The Android plugin wants a 32-bit number; the same notice always gets the same one. */
function numericId(text: string): number {
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (Math.imul(hash, 31) + text.charCodeAt(index)) | 0;
  }
  return Math.abs(hash) % 2_147_483_647;
}
