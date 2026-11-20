import { useState, type FormEvent, type JSX } from 'react';
import { Button, Logo, SelectField, TextField } from '@/design';
import { activationCodeOf } from '@/domain/activationCode';
import type { OnboardingResult } from '@/server/onboarding';
import {
  pairedSettings,
  type ClaimedDevice,
  type FullPlan,
  type OwnedMarket,
  type OwnedRegister,
} from '@/server/pairing';
import { formatDateTime } from '@/pos/format';
import { ActivationCodeField } from './ActivationCodeField';
import type { DeviceSettings } from './device';
import { SUPPORT } from './support';
import { SupportLink } from './SupportLink';

type Credentials = { email: string; password: string };

export type WelcomeScreenProps = {
  current: DeviceSettings;
  open(
    input: Credentials & { marketName: string; activationCode: string },
  ): Promise<OnboardingResult>;
  join(input: Credentials & { marketId?: string; replaceCode?: string }): Promise<OnboardingResult>;
  /** Binds this device with a pairing code from the seller or the restaurant's owner. */
  claim(input: {
    code: string;
    deviceCode: string;
    deviceName: string;
    replace?: boolean;
  }): Promise<ClaimedDevice>;
  onDone(settings: DeviceSettings): void;
  /** The seller's WhatsApp number; this build's by default. */
  supportNumber?: string | null;
};

const failed = (error: unknown) =>
  error instanceof Error
    ? error.message
    : 'Bağlantı kurulamadı. İnternet bağlantısını kontrol edin.';

/** The plan's register limit when that is why the device could not join, else null. */
const deviceLimitOf = (error: unknown): number | null =>
  error instanceof Error && typeof (error as { deviceLimit?: unknown }).deviceLimit === 'number'
    ? (error as unknown as { deviceLimit: number }).deviceLimit
    : null;

const licenseExpiredOf = (error: unknown): boolean =>
  error instanceof Error && (error as { licenseExpired?: unknown }).licenseExpired === true;

/** The pairing code as typed or pasted: capitals and digits only, at most eight. */
const pairingCodeOf = (text: string) =>
  text
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8);

/** A register as the owner knows it: its code, its name and when it was last seen. */
const registerLabel = (register: OwnedRegister) =>
  [
    register.code,
    register.name,
    ...(register.lastSeenAt ? [`son görülme ${formatDateTime(register.lastSeenAt)}`] : []),
  ].join(' · ');

/**
 * The app's first screen: open the restaurant with its own email and the seller's one-time code,
 * or sign another device into it. Either way this device becomes one of the restaurant's
 * registers; the password is not kept.
 */
export function WelcomeScreen({
  current,
  open,
  join,
  claim,
  onDone,
  supportNumber,
}: WelcomeScreenProps): JSX.Element {
  const [mode, setMode] = useState<'choose' | 'open' | 'join' | 'pair'>('choose');
  const [activationCode, setActivationCode] = useState('');
  const [marketName, setMarketName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [markets, setMarkets] = useState<OwnedMarket[]>();
  const [marketId, setMarketId] = useState('');
  // The plan has no room for this device: it may take the place of one of these registers.
  const [full, setFull] = useState<FullPlan>();
  const [replaceCode, setReplaceCode] = useState('');
  const [error, setError] = useState<string>();
  const [deviceLimit, setDeviceLimit] = useState<number | null>(null);
  const [licenseExpired, setLicenseExpired] = useState(false);
  const [pairCode, setPairCode] = useState('');
  const [deviceCode, setDeviceCode] = useState(current.deviceCode);
  const [deviceName, setDeviceName] = useState('');
  // Another register holds the Kasa kodu: set once the server says so, ticked to take it over.
  const [takeover, setTakeover] = useState<boolean>();
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);
  const support = supportNumber === undefined ? {} : { number: supportNumber };

  function settle(result: OnboardingResult) {
    if ('claimed' in result) {
      const name = `Kasa ${result.claimed.deviceCode}`;
      onDone(pairedSettings(current, result.claimed, name, false));
    } else if ('markets' in result) {
      setMarkets(result.markets);
      setMarketId(result.markets[0]?.id ?? '');
    } else if ('full' in result) {
      setFull(result.full);
      setReplaceCode(result.full.devices[0]?.code ?? '');
      setDeviceLimit(result.full.limit);
    } else {
      setNotice(
        'E-postanızı onaylayın, sonra tekrar deneyin: e-postanıza gelen bağlantıya tıklayın, sonra “Restoranı kur”a yeniden basın. Kurulum kodunuz kullanılmadı.',
      );
    }
  }

  async function run(task: () => Promise<OnboardingResult>) {
    setBusy(true);
    setError(undefined);
    setDeviceLimit(null);
    setLicenseExpired(false);
    setNotice(undefined);
    try {
      settle(await task());
    } catch (reason) {
      setError(failed(reason));
      setDeviceLimit(deviceLimitOf(reason));
      setLicenseExpired(licenseExpiredOf(reason));
    } finally {
      setBusy(false);
    }
  }

  function submitOpen(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = activationCodeOf(activationCode);
    if (code === null) {
      setError('Kurulum kodunu eksiksiz yazın: RK- ve 12 harf ya da rakam.');
      return;
    }
    if (password.length < 8) {
      setError('Şifre en az 8 karakter olmalı.');
      return;
    }
    if (password !== repeat) {
      setError('Şifreler aynı değil.');
      return;
    }
    void run(() =>
      open({ marketName: marketName.trim(), email: email.trim(), password, activationCode: code }),
    );
  }

  function submitJoin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(() =>
      join({
        email: email.trim(),
        password,
        ...(markets && marketId ? { marketId } : {}),
        ...(full && replaceCode ? { marketId: full.market.id, replaceCode } : {}),
      }),
    );
  }

  async function submitPair(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || pairCode.length !== 8) {
      return;
    }
    const registerCode = deviceCode.trim().toUpperCase() || current.deviceCode;
    const name = deviceName.trim() || `Kasa ${registerCode}`;
    setBusy(true);
    setError(undefined);
    setDeviceLimit(null);
    setLicenseExpired(false);
    try {
      const claimed = await claim({
        code: pairCode,
        deviceCode: registerCode,
        deviceName: name,
        ...(takeover ? { replace: true } : {}),
      });
      onDone(pairedSettings(current, claimed, name, false));
    } catch (reason) {
      if ((reason as { taken?: boolean }).taken && takeover === undefined) {
        setTakeover(false);
      }
      setError(failed(reason));
      setDeviceLimit(deviceLimitOf(reason));
      setLicenseExpired(licenseExpiredOf(reason));
    } finally {
      setBusy(false);
    }
  }

  function choose(next: 'open' | 'join' | 'pair') {
    setMode(next);
    setError(undefined);
    setDeviceLimit(null);
    setLicenseExpired(false);
    setTakeover(undefined);
    setNotice(undefined);
    setMarkets(undefined);
    setFull(undefined);
  }

  const messages = (
    <>
      {error ? (
        <p role="alert" className="font-medium text-danger">
          {error}
        </p>
      ) : null}
      {deviceLimit !== null ? (
        <SupportLink topic={SUPPORT.devices(deviceLimit)} {...support} />
      ) : null}
      {licenseExpired ? <SupportLink topic={SUPPORT.licenseExpired} {...support} /> : null}
      {notice ? (
        <p role="status" className="font-medium">
          {notice}
        </p>
      ) : null}
    </>
  );

  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg p-4">
      <div className="flex w-full max-w-md flex-col gap-6 rounded-control border border-line bg-surface p-6">
        <div className="flex items-center gap-3">
          <Logo className="size-11" />
          <div>
            <h1 className="text-xl font-semibold">Restoran Kasa</h1>
            <p className="text-sm text-text-2">
              {mode === 'open'
                ? 'Yeni restoran'
                : mode === 'join'
                  ? 'Bu cihazı restoranınıza ekleyin'
                  : mode === 'pair'
                    ? 'Bağlantı koduyla bağlan'
                    : 'Hoş geldiniz'}
            </p>
          </div>
        </div>

        {mode === 'choose' ? (
          <div className="flex flex-col gap-3">
            <Button variant="primary" onClick={() => choose('open')}>
              Restoran kur
            </Button>
            <Button onClick={() => choose('join')}>Restorana giriş yap</Button>
            <Button variant="ghost" onClick={() => choose('pair')}>
              Bağlantı koduyla bağlan
            </Button>
            <p className="text-sm text-text-2">
              Restoranı ilk kez kuruyorsanız satıcınızın gönderdiği kurulum koduyla “Restoran kur”.
              Başka bir cihazda kurduysanız aynı e-posta ve şifreyle “Restorana giriş yap”: bu cihaz
              o restoranın yeni kasası olur.
            </p>
          </div>
        ) : null}

        {mode === 'open' ? (
          <form className="flex flex-col gap-3" onSubmit={submitOpen}>
            <div className="flex flex-col gap-1">
              <ActivationCodeField value={activationCode} onChange={setActivationCode} />
              <SupportLink topic={SUPPORT.code} {...support} />
            </div>
            <TextField
              label="Restoran adı"
              value={marketName}
              maxLength={60}
              required
              onChange={(event) => setMarketName(event.target.value)}
            />
            <TextField
              label="E-posta"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <TextField
              label="Şifre"
              type="password"
              autoComplete="new-password"
              hint="En az 8 karakter. Bu şifreyle başka cihazları da bağlarsınız."
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <TextField
              label="Şifre (tekrar)"
              type="password"
              autoComplete="new-password"
              value={repeat}
              onChange={(event) => setRepeat(event.target.value)}
            />
            {messages}
            <Button type="submit" variant="primary" disabled={busy}>
              Restoranı kur
            </Button>
            <Button variant="ghost" onClick={() => setMode('choose')}>
              Geri
            </Button>
          </form>
        ) : null}

        {mode === 'join' ? (
          <form className="flex flex-col gap-3" onSubmit={submitJoin}>
            <TextField
              label="E-posta"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <TextField
              label="Şifre"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            {markets ? (
              <SelectField
                label="Restoran"
                value={marketId}
                onChange={(event) => setMarketId(event.target.value)}
                options={markets.map((market) => ({ value: market.id, label: market.name }))}
              />
            ) : null}
            {full ? (
              <div className="flex flex-col gap-2 rounded-control border border-line p-3">
                <p role="status" className="font-medium">
                  {`${full.market.name}: paketinizin cihaz sınırı dolu (${full.limit} cihaz).`}
                </p>
                <p className="text-sm text-text-2">
                  Bu cihaz artık kullanılmayan bir kasanın yerine geçebilir. Seçilen kasa
                  restorandan çıkarılır; o cihazda gönderilmemiş işlem varsa restorana ulaşmaz.
                </p>
                <SelectField
                  label="Yerine geçeceği kasa"
                  value={replaceCode}
                  onChange={(event) => setReplaceCode(event.target.value)}
                  options={full.devices.map((register) => ({
                    value: register.code,
                    label: registerLabel(register),
                  }))}
                />
              </div>
            ) : null}
            {messages}
            <Button type="submit" variant="primary" disabled={busy || !password}>
              {full ? 'Yerine geç' : 'Giriş yap'}
            </Button>
            <Button variant="ghost" onClick={() => setMode('choose')}>
              Geri
            </Button>
          </form>
        ) : null}

        {mode === 'pair' ? (
          <form className="flex flex-col gap-3" onSubmit={(event) => void submitPair(event)}>
            <TextField
              label="Bağlantı kodu"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              hint="Satıcınızın ya da restoran sahibinin verdiği 8 haneli kod"
              value={pairCode}
              onChange={(event) => setPairCode(pairingCodeOf(event.target.value))}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField
                label="Kasa kodu"
                autoComplete="off"
                maxLength={4}
                value={deviceCode}
                onChange={(event) => setDeviceCode(event.target.value.toUpperCase())}
              />
              <TextField
                label="Cihaz adı"
                maxLength={40}
                placeholder={`Kasa ${deviceCode.trim().toUpperCase() || current.deviceCode}`}
                value={deviceName}
                onChange={(event) => setDeviceName(event.target.value)}
              />
            </div>
            {takeover !== undefined ? (
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={takeover}
                  onChange={(event) => setTakeover(event.target.checked)}
                  className="size-5"
                />
                {`${deviceCode.trim().toUpperCase()} cihazının yerine geç (eski cihaz iptal edilir)`}
              </label>
            ) : null}
            {messages}
            <Button type="submit" variant="primary" disabled={busy || pairCode.length !== 8}>
              {takeover ? 'Yerine geç' : 'Bağla'}
            </Button>
            <Button variant="ghost" onClick={() => setMode('choose')}>
              Geri
            </Button>
          </form>
        ) : null}
      </div>
    </main>
  );
}

/** A build without a server cannot create or reach an account, so it opens nothing. */
export function ServerMissingScreen(): JSX.Element {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg p-4">
      <div className="flex w-full max-w-md flex-col gap-4 rounded-control border border-line bg-surface p-6">
        <div className="flex items-center gap-3">
          <Logo className="size-11" />
          <h1 className="text-xl font-semibold">Restoran Kasa</h1>
        </div>
        <p role="alert" className="font-medium text-danger">
          Sunucu ayarlı değil. Uygulama hesapsız kullanılamaz; güncel sürümü yükleyin ya da destekle
          iletişime geçin.
        </p>
      </div>
    </main>
  );
}
