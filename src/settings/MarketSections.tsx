import { useLiveQuery } from 'dexie-react-hooks';
import { useState, type FormEvent, type JSX, type ReactNode } from 'react';
import { useActor } from '@/app/actor';
import { useData } from '@/app/appData';
import { saveDeviceSettings } from '@/app/device';
import { finishPairing } from '@/app/finishPairing';
import { useMarketSettings } from '@/app/marketSettings';
import { SUPPORT } from '@/app/support';
import { SupportLink } from '@/app/SupportLink';
import { currentCashSession } from '@/data/cash';
import { loadStoredLicense, type LicensePlan } from '@/data/license';
import { pendingCount } from '@/data/outbox';
import { saveMarketSettings } from '@/data/settings';
import { Button, SelectField, TextField } from '@/design';
import { licenseState } from '@/domain/license';
import { ReceiptSettingsDialog } from '@/pos/ReceiptSettingsDialog';
import { loadReceiptSettings, saveReceiptSettings } from '@/pos/receiptSettings';
import { formatPeriod } from '@/reports/reportFormat';
import { reportRegisters } from '@/reports/summary';
import { deviceClient, ownerClient } from '@/server/client';
import { SERVER } from '@/server/config';
import { createPairingCode, currentPlatform, pairDevice, unpairedSettings } from '@/server/pairing';
import { useSyncStatus } from '@/app/appData';
import { DeviceRevokedError, DeviceUnpairedError } from '@/sync/supabaseTransport';
import { PairDialog, PairingAction } from './PairDialog';

// The day may turn on the hour from midnight to noon (DESIGN §9).
const CUTOFF_OPTIONS = Array.from({ length: 13 }, (_, hour) => ({
  value: String(hour * 60),
  label: `${String(hour).padStart(2, '0')}:00`,
}));

/** A titled block of the settings screen, named for assistive technology by its heading. */
export function SettingsSection({
  id,
  title,
  description,
  action,
  children,
}: {
  id: string;
  title: string;
  description: string;
  action?: ReactNode;
  children?: ReactNode;
}): JSX.Element {
  return (
    <section
      aria-labelledby={id}
      className="flex flex-col gap-3 rounded-control border border-line bg-surface p-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h2 id={id} className="text-lg font-semibold">
            {title}
          </h2>
          <p className="text-sm text-text-2">{description}</p>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** The settings every register of the market shares: when the business day turns. */
export function MarketSection({ onDone }: { onDone(message: string): void }): JSX.Element {
  const { db } = useData();
  const actor = useActor();
  const { cutoffMinutes } = useMarketSettings();
  const [chosen, setChosen] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const value = chosen ?? String(cutoffMinutes);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      await saveMarketSettings(db, { cutoffMinutes: Number(value) }, new Date(), actor);
      setChosen(null);
      onDone('İşletme ayarı kaydedildi.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsSection
      id="market-heading"
      title="İşletme"
      description="Restoranın bütün cihazlarında aynıdır. Gün dönümünden önceki satışlar bir önceki güne yazılır; yazılmış kayıtlar değişmez."
    >
      <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => void save(event)}>
        <div className="w-40">
          <SelectField
            label="Gün dönümü"
            options={CUTOFF_OPTIONS}
            value={value}
            onChange={(event) => setChosen(event.target.value)}
          />
        </div>
        <Button type="submit" disabled={saving || value === String(cutoffMinutes)}>
          İşletme ayarını kaydet
        </Button>
      </form>
    </SettingsSection>
  );
}

/** This device's own names and register code; the app reads them when it starts. */
export function RegisterSection(): JSX.Element {
  const { db, settings, runner } = useData();
  const status = useSyncStatus(runner);
  const [marketName, setMarketName] = useState(settings.marketName);
  const [deviceName, setDeviceName] = useState(settings.deviceName);
  const [deviceCode, setDeviceCode] = useState(settings.deviceCode);
  const [message, setMessage] = useState<{ text: string; error: boolean }>();
  // A code with sales on it, which the person has been warned about once.
  const [warnedCode, setWarnedCode] = useState<string>();
  const [pairing, setPairing] = useState(false);
  const queued = useLiveQuery(() => pendingCount(db), [db]) ?? 0;
  // A paired register's code is the server's: changing it here would split its receipts.
  const paired = settings.paired === true;
  const server = SERVER;
  const lost =
    status.error === new DeviceUnpairedError().message ||
    status.error === new DeviceRevokedError().message;

  async function repair() {
    if (server) {
      await deviceClient(server).auth.signOut({ scope: 'local' });
    }
    if (saveDeviceSettings(unpairedSettings(settings))) {
      window.location.reload();
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = deviceCode.trim().toUpperCase();
    if (code !== settings.deviceCode) {
      // The drawer and the Z belong to the code: a new code would leave the open drawer behind.
      if (await currentCashSession(db, settings.deviceCode)) {
        setMessage({
          text: 'Bu cihazda gün kapanmadı: önce gün sonunu alın, sonra kodu değiştirin.',
          error: true,
        });
        return;
      }
      // It may be this register's own old code, or another register's: only the person knows.
      if (code !== warnedCode && (await reportRegisters(db)).includes(code)) {
        setWarnedCode(code);
        setMessage({
          text: `${code} koduyla daha önce satış yapılmış. Bu kod başka bir cihazınsa fiş numaraları karışır; yine de kullanmak için yeniden kaydedin.`,
          error: true,
        });
        return;
      }
    }
    const saved = saveDeviceSettings({ ...settings, marketName, deviceName, deviceCode });
    setMessage(
      saved
        ? { text: 'Kaydedildi. Uygulama yeniden açıldığında geçerli olur.', error: false }
        : {
            text: 'Kaydedilemedi: adlar 1-60 karakter, cihaz kodu bir harf ve en çok üç harf ya da rakam olmalı (K1, K2).',
            error: true,
          },
    );
  }

  return (
    <SettingsSection
      id="register-heading"
      title="Bu cihaz"
      description="Fişte ve raporlarda görünen adlar ile fiş numarasının başındaki cihaz kodu."
      action={
        <PairingAction
          config={SERVER}
          paired={paired}
          lost={lost}
          onOpen={() => setPairing(true)}
          onRepair={() => void repair()}
        />
      }
    >
      {pairing && server ? (
        <PairDialog
          current={settings}
          pendingCount={queued}
          createCode={(input) => createPairingCode({ owner: ownerClient(server), ...input })}
          claim={(input) =>
            pairDevice({ device: deviceClient(server), platform: currentPlatform(), ...input })
          }
          onPaired={(next) => {
            if (!finishPairing(next)) {
              return false;
            }
            window.location.reload();
            return true;
          }}
          onClose={() => setPairing(false)}
        />
      ) : null}
      <form className="flex flex-col gap-3" onSubmit={(event) => void save(event)}>
        <div className="grid gap-3 sm:grid-cols-3">
          <TextField
            label="İşletme adı"
            value={marketName}
            onChange={(event) => setMarketName(event.target.value)}
          />
          <TextField
            label="Cihaz adı"
            value={deviceName}
            onChange={(event) => setDeviceName(event.target.value)}
          />
          <TextField
            label="Cihaz kodu"
            autoComplete="off"
            maxLength={4}
            readOnly={paired}
            value={deviceCode}
            onChange={(event) => setDeviceCode(event.target.value.toUpperCase())}
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit">Cihazı kaydet</Button>
          {message ? (
            <p role="status" className={message.error ? 'text-danger' : 'text-text-2'}>
              {message.text}
            </p>
          ) : null}
          {message && !message.error ? (
            <Button variant="ghost" onClick={() => window.location.reload()}>
              Şimdi yeniden aç
            </Button>
          ) : null}
        </div>
      </form>
    </SettingsSection>
  );
}

/** The receipt's printing and wording, the same dialog the register opens. */
export function ReceiptSection({ onDone }: { onDone(message: string): void }): JSX.Element {
  const { settings } = useData();
  const [open, setOpen] = useState(false);
  return (
    <SettingsSection
      id="receipt-heading"
      title="Fiş"
      description="Fiş yazdırma, kâğıt genişliği, üst ve alt yazılar."
      action={<Button onClick={() => setOpen(true)}>Fiş ayarları</Button>}
    >
      {open ? (
        <ReceiptSettingsDialog
          open
          settings={loadReceiptSettings()}
          marketName={settings.marketName}
          onClose={() => setOpen(false)}
          onSave={(next) => {
            saveReceiptSettings(next);
            setOpen(false);
            onDone('Fiş ayarları kaydedildi.');
          }}
        />
      ) : null}
    </SettingsSection>
  );
}

/** How many registers a plan allows, in words. */
function planText(plan: LicensePlan): string {
  return `Paket: ${plan.name} · ${
    plan.maxDevices === null ? 'sınırsız cihaz' : `en çok ${plan.maxDevices} cihaz`
  }`;
}

/** The licence's last day and plan as last heard from the server, and where it stands. */
export function LicenseSection(): JSX.Element {
  const { db, settings } = useData();
  // undefined while loading; null when the server has never said.
  const stored = useLiveQuery(() => loadStoredLicense(db), [db]);
  const { cutoffMinutes } = useMarketSettings();
  const expiresAt = stored?.expiresAt ?? null;
  const state = expiresAt === null ? null : licenseState(expiresAt, new Date(), { cutoffMinutes });
  const text =
    stored === undefined
      ? null
      : stored === null
        ? 'Bilinmiyor: lisans tarihi sunucu bağlantısıyla gelir.'
        : expiresAt === null
          ? 'Süresiz.'
          : state?.kind === 'unknown'
            ? 'Bilinmiyor: lisans tarihi sunucu bağlantısıyla gelir.'
            : `Son gün ${formatPeriod(expiresAt, expiresAt)}${
                state?.kind === 'readOnly' ? ' · süresi doldu, satış kapalı' : ''
              }`;
  return (
    <SettingsSection
      id="license-heading"
      title="Lisans"
      description="Bitişe 7 gün kala uyarı çıkar; bitişten sonra 7 gün daha satış ve eşitleme sürer, sonra satış kapanır ve sunucu eşitlemeyi durdurur."
    >
      {text ? <p>{text}</p> : null}
      {stored?.plan ? <p className="text-text-2">{planText(stored.plan)}</p> : null}
      {expiresAt !== null ? <SupportLink topic={SUPPORT.license(settings.marketName)} /> : null}
    </SettingsSection>
  );
}
