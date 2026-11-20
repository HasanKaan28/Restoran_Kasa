import { useEffect, useState, useSyncExternalStore, type JSX } from 'react';
import { Button, ChoiceGroup } from '@/design';
import { SettingsSection } from '@/settings/MarketSections';
import {
  notifyPrefsSnapshot,
  saveNotifyPrefs,
  subscribeNotifyPrefs,
  type NotifyPrefs,
} from './prefs';
import { TRY_NOTICE_EVENT } from './ReadyNotifier';
import { askSystemPermission, systemPermission, type SystemPermission } from './system';

const SCOPES: readonly { value: NotifyPrefs['scope']; label: string }[] = [
  { value: 'mine', label: 'Sadece benim siparişlerim' },
  { value: 'all', label: 'Tüm hazırlar' },
];

const PERMISSION_TEXT: Record<SystemPermission, string> = {
  granted: 'Telefon bildirimi açık: uygulama arka plandayken de bildirim gelir.',
  default:
    'Uygulama arka plandayken (başka bir uygulamaya geçince) de telefonun kendi bildirimi gelsin isterseniz izin verin. Cihaz bir kez sorar.',
  denied:
    'Telefon bildirimine izin verilmemiş. Açmak için tarayıcının ya da telefonun ayarlarından bu uygulamaya bildirim izni verin.',
  unsupported:
    'Bu cihaz telefon bildirimi göstermiyor; ekrandaki uyarı, ses ve titreşim yine çalışır.',
};

/**
 * This device's "order ready" notices: on or off, whose orders, sound and vibration, and the
 * device's own notification, whose permission is asked here and only here, after saying why.
 */
export function NotificationsSection(): JSX.Element {
  const prefs = useSyncExternalStore(subscribeNotifyPrefs, notifyPrefsSnapshot);
  const [permission, setPermission] = useState<SystemPermission>();

  useEffect(() => {
    let live = true;
    void systemPermission().then((answer) => live && setPermission(answer));
    return () => {
      live = false;
    };
  }, []);

  const change = (next: Partial<NotifyPrefs>) => saveNotifyPrefs({ ...prefs, ...next });

  return (
    <SettingsSection
      id="notify-heading"
      title="Bildirimler"
      description="Mutfak ya da bar bir siparişi hazır işaretleyince bu cihaz haber verir: “Masa 5 hazır: 2 × Adana kebap”. Mutfak / Bar ekranı açıkken haber vermez. Bu cihaza özeldir."
      action={
        <Button
          disabled={!prefs.enabled}
          onClick={() => window.dispatchEvent(new Event(TRY_NOTICE_EVENT))}
        >
          Dene
        </Button>
      }
    >
      <Toggle
        label="Hazır bildirimleri"
        checked={prefs.enabled}
        onChange={(enabled) => change({ enabled })}
      />
      <fieldset disabled={!prefs.enabled} className="flex flex-col gap-3 disabled:opacity-60">
        <ChoiceGroup<NotifyPrefs['scope']>
          legend="Hangi siparişler"
          name="notify-scope"
          options={SCOPES}
          value={prefs.scope}
          onChange={(scope) => change({ scope })}
        />
        <p className="text-sm text-text-2">
          {prefs.scope === 'mine'
            ? 'Bu cihazda giriş yapmış garsonun aldığı siparişler; kimse giriş yapmamışsa bu cihazdan alınanlar.'
            : 'Kimin aldığına bakmadan her hazır sipariş.'}
        </p>
        <Toggle label="Ses" checked={prefs.sound} onChange={(sound) => change({ sound })} />
        <Toggle
          label="Titreşim"
          checked={prefs.vibrate}
          onChange={(vibrate) => change({ vibrate })}
        />
        <div className="flex flex-col gap-2 border-t border-line pt-3">
          <h3 className="font-semibold">Telefon bildirimi</h3>
          {permission === undefined ? null : (
            <>
              <p className="text-sm text-text-2">{PERMISSION_TEXT[permission]}</p>
              {permission === 'default' ? (
                <Button
                  className="self-start"
                  onClick={() => void askSystemPermission().then(setPermission)}
                >
                  Bildirim izni ver
                </Button>
              ) : null}
            </>
          )}
          <p className="text-sm text-muted">
            Telefon kilitliyken ya da uygulama kapalıyken bildirim gelmez; uygulamayı açık tutun.
          </p>
        </div>
      </fieldset>
    </SettingsSection>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange(checked: boolean): void;
}): JSX.Element {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-3 font-medium">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="size-5 accent-accent"
      />
      {label}
    </label>
  );
}
