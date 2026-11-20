import { History, KeyRound, LayoutDashboard, LogOut, Megaphone, Store } from 'lucide-react';
import { useEffect, useState, type FormEvent, type JSX, type KeyboardEvent } from 'react';
import { Button, ChoiceGroup, Logo, TextField } from '@/design';
import { operatorApi, type OperatorApi, type OperatorClient } from './api';
import { AnnouncementsTab } from './AnnouncementsTab';
import { CodesTab } from './CodesTab';
import { HistoryTab } from './HistoryTab';
import { OverviewTab } from './OverviewTab';
import { RestaurantDetail } from './RestaurantDetail';
import { RestaurantsTab } from './RestaurantsTab';

type Phase =
  | { kind: 'loading' }
  | { kind: 'signedOut' }
  | { kind: 'notOperator'; email: string }
  | { kind: 'operator'; email: string }
  | { kind: 'failed'; message: string };

const OFFLINE = 'Bağlantı kurulamadı. İnternet bağlantısını kontrol edin.';

/** Whether the signed-in account is an operator, asked of the server. */
async function phaseFor(api: OperatorApi, email: string): Promise<Phase> {
  try {
    return (await api.whoami()) ? { kind: 'operator', email } : { kind: 'notOperator', email };
  } catch (error) {
    return { kind: 'failed', message: error instanceof Error ? error.message : OFFLINE };
  }
}

/**
 * The seller's yönetim page: he signs in with his own account; an operator issues activation
 * codes and looks after the restaurants, anyone else is told the account is not one.
 */
export function AdminApp({ client }: { client: OperatorClient }): JSX.Element {
  const [api] = useState(() => operatorApi(client));
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });

  const check = (email: string) => void phaseFor(api, email).then(setPhase);

  useEffect(() => {
    let live = true;
    void client.auth
      .getSession()
      .then(({ data }) =>
        data.session
          ? phaseFor(api, data.session.user.email ?? '')
          : ({ kind: 'signedOut' } as const),
      )
      .catch((): Phase => ({ kind: 'signedOut' }))
      .then((next) => {
        if (live) {
          setPhase(next);
        }
      });
    return () => {
      live = false;
    };
  }, [api, client]);

  async function signOut() {
    await client.auth.signOut({ scope: 'local' }).catch(() => undefined);
    setPhase({ kind: 'signedOut' });
  }

  if (phase.kind === 'operator') {
    return <OperatorPage api={api} email={phase.email} onSignOut={() => void signOut()} />;
  }
  return (
    <main className="flex min-h-dvh items-start justify-center bg-bg px-4 py-8 sm:items-center">
      <div className="flex w-full max-w-md flex-col gap-6 rounded-plate border border-line bg-surface p-5 sm:p-6">
        <Brand />
        {phase.kind === 'loading' ? (
          <p role="status" className="text-text-2">
            Yükleniyor…
          </p>
        ) : null}
        {phase.kind === 'signedOut' ? <SignInForm client={client} onSignedIn={check} /> : null}
        {phase.kind === 'notOperator' ? (
          <div className="flex flex-col gap-4">
            <p role="alert" className="font-medium text-danger">
              Bu hesap yönetici değil.
            </p>
            <p className="text-sm text-text-2">
              {phase.email ? `${phase.email} ile giriş yapıldı. ` : ''}Yönetici yetkisi
              veritabanında verilir; verildikten sonra bu sayfayı yenileyin.
            </p>
            <Button onClick={() => void signOut()}>Başka hesapla giriş yap</Button>
          </div>
        ) : null}
        {phase.kind === 'failed' ? (
          <div className="flex flex-col gap-4">
            <p role="alert" className="font-medium text-danger">
              {phase.message}
            </p>
            <Button onClick={() => window.location.reload()}>Yeniden dene</Button>
          </div>
        ) : null}
      </div>
    </main>
  );
}

function Brand({ small = false }: { small?: boolean }): JSX.Element {
  return (
    <div className="flex items-center gap-3">
      <Logo className={small ? 'size-8' : 'size-11'} />
      <div className="leading-tight">
        <h1 className={`font-semibold ${small ? 'text-base' : 'text-xl'}`}>Restoran Kasa</h1>
        <p className="text-sm text-text-2">Yönetim</p>
      </div>
    </div>
  );
}

function signInFailure(message: string): string {
  if (/invalid login/i.test(message)) {
    return 'E-posta ya da şifre yanlış.';
  }
  if (/not confirmed/i.test(message)) {
    return 'E-posta adresi henüz doğrulanmadı. E-postanıza gelen bağlantıya tıklayın.';
  }
  if (/already registered/i.test(message)) {
    return 'Bu e-postanın hesabı var; “Giriş yap” ile girin.';
  }
  if (/password/i.test(message)) {
    return 'Şifre en az 8 karakter olmalı.';
  }
  if (/rate limit|too many/i.test(message)) {
    return 'Çok fazla deneme oldu. Birkaç dakika sonra yeniden deneyin.';
  }
  return OFFLINE;
}

function SignInForm({
  client,
  onSignedIn,
}: {
  client: OperatorClient;
  onSignedIn(email: string): void;
}): JSX.Element {
  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    setNotice(undefined);
    if (mode === 'signUp' && password.length < 8) {
      setError('Şifre en az 8 karakter olmalı.');
      return;
    }
    setBusy(true);
    const credentials = { email: email.trim(), password };
    try {
      const { data, error: failure } =
        mode === 'signIn'
          ? await client.auth.signInWithPassword(credentials)
          : await client.auth.signUp({
              ...credentials,
              options: { emailRedirectTo: `${window.location.origin}${window.location.pathname}` },
            });
      if (failure) {
        setError(signInFailure(failure.message));
      } else if (data.session) {
        onSignedIn(data.session.user.email ?? credentials.email);
      } else {
        setNotice('E-postanıza gelen bağlantıya tıklayın, sonra buradan giriş yapın.');
      }
    } catch {
      setError(OFFLINE);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
      <ChoiceGroup
        legend="Hesap"
        hideLegend
        name="account"
        value={mode}
        options={[
          { value: 'signIn', label: 'Giriş yap' },
          { value: 'signUp', label: 'Hesap oluştur' },
        ]}
        onChange={(next) => {
          setMode(next);
          setError(undefined);
          setNotice(undefined);
        }}
      />
      <TextField
        label="E-posta"
        type="email"
        name="email"
        autoComplete="email"
        spellCheck={false}
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <TextField
        label="Şifre"
        type="password"
        name="password"
        autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
        required
        {...(mode === 'signUp' ? { hint: 'En az 8 karakter.' } : {})}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      {mode === 'signUp' ? (
        <p className="rounded-control border-l-4 border-warning bg-warning-bg px-3 py-2 text-sm text-text">
          Yeni hesap, yönetici olarak işaretlenene kadar hiçbir şey göremez. Hesabı açtıktan sonra
          yönetici yetkisini veritabanından bir kez verin.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="font-medium text-danger">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="font-medium">
          {notice}
        </p>
      ) : null}
      <Button type="submit" variant="primary" disabled={busy || !email || !password}>
        {mode === 'signIn' ? 'Giriş yap' : 'Hesap oluştur'}
      </Button>
    </form>
  );
}

type Tab = 'overview' | 'restaurants' | 'codes' | 'announcements' | 'history';
const TABS: readonly { id: Tab; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'overview', label: 'Özet', icon: LayoutDashboard },
  { id: 'restaurants', label: 'Restoranlar', icon: Store },
  { id: 'codes', label: 'Kodlar', icon: KeyRound },
  { id: 'announcements', label: 'Duyuru', icon: Megaphone },
  { id: 'history', label: 'Geçmiş', icon: History },
];

function OperatorPage({
  api,
  email,
  onSignOut,
}: {
  api: OperatorApi;
  email: string;
  onSignOut(): void;
}): JSX.Element {
  const [tab, setTab] = useState<Tab>('overview');
  // A restaurant opened from any tab; its detail takes the panel until "Geri".
  const [opened, setOpened] = useState<string | null>(null);

  function choose(next: Tab) {
    setTab(next);
    setOpened(null);
    document.documentElement.scrollTo?.({ top: 0 });
  }

  function open(marketId: string) {
    setOpened(marketId);
    document.documentElement.scrollTo?.({ top: 0 });
  }

  function onTabKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return;
    }
    const at = TABS.findIndex((item) => item.id === tab);
    const step = event.key === 'ArrowRight' ? 1 : -1;
    const next = TABS[(at + step + TABS.length) % TABS.length]?.id ?? tab;
    choose(next);
    document.getElementById(`tab-${next}`)?.focus();
  }

  return (
    <div className="min-h-dvh bg-bg">
      <header className="sticky top-0 z-10 border-b border-line bg-surface pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-2">
          <Brand small />
          <span className="ml-auto truncate text-sm text-text-2 max-sm:sr-only">{email}</span>
          <Button
            variant="ghost"
            className="max-sm:ml-auto"
            icon={<LogOut aria-hidden="true" size={18} strokeWidth={1.75} />}
            onClick={onSignOut}
          >
            Çıkış
          </Button>
        </div>
        {/* On a phone the tabs sit at the bottom, under the thumb, as the app's own do. */}
        <div
          role="tablist"
          aria-label="Yönetim"
          onKeyDown={onTabKey}
          className="mx-auto flex max-w-3xl gap-1 px-4 max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:z-20 max-sm:gap-0 max-sm:border-t max-sm:border-line max-sm:bg-surface max-sm:px-0 max-sm:pb-[env(safe-area-inset-bottom)]"
        >
          {TABS.map((item) => {
            const Icon = item.icon;
            const selected = tab === item.id;
            return (
              <button
                key={item.id}
                id={`tab-${item.id}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={`panel-${item.id}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => choose(item.id)}
                className={`flex min-h-touch items-center justify-center gap-2 font-semibold transition-colors max-sm:min-w-0 max-sm:flex-1 max-sm:flex-col max-sm:gap-0.5 max-sm:py-2 max-sm:text-meta sm:border-b-2 sm:px-3 ${
                  selected
                    ? 'text-text sm:border-accent max-sm:text-accent'
                    : 'text-text-2 hover:text-text sm:border-transparent'
                }`}
              >
                <Icon aria-hidden="true" size={20} strokeWidth={selected ? 2.25 : 1.75} />
                <span className="max-sm:max-w-full max-sm:truncate">{item.label}</span>
              </button>
            );
          })}
        </div>
      </header>
      <main
        id={`panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`tab-${tab}`}
        className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] max-sm:pb-[calc(6rem+env(safe-area-inset-bottom))]"
      >
        {opened ? (
          <RestaurantDetail
            key={opened}
            api={api}
            marketId={opened}
            onBack={() => setOpened(null)}
          />
        ) : tab === 'overview' ? (
          <OverviewTab api={api} onOpen={open} />
        ) : tab === 'restaurants' ? (
          <RestaurantsTab api={api} onOpen={open} />
        ) : tab === 'codes' ? (
          <CodesTab api={api} />
        ) : tab === 'announcements' ? (
          <AnnouncementsTab api={api} />
        ) : (
          <HistoryTab api={api} onOpen={open} />
        )}
      </main>
    </div>
  );
}
