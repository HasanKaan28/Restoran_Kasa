import { useLiveQuery } from 'dexie-react-hooks';
import { ExternalLink, Printer } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent, type JSX } from 'react';
import { useData } from '@/app/appData';
import { listDiningTables } from '@/data/restaurant';
import { Button, ChoiceGroup, Dialog, TextField } from '@/design';
import { tableLabel } from '@/menu/model';
import { printView } from '@/pos/printView';
import { deviceClient, ownerClient } from '@/server/client';
import { SERVER } from '@/server/config';
import { changeQrMenu, menuLink, menuPageUrl, readQrMenu, type QrMenuState } from '@/server/qrMenu';
import { tableLabelIn } from './tableTitle';
import { SettingsSection } from '@/settings/MarketSections';
import { TableCardPreview, TableCardSheet } from './TableCards';
import { CARD_PAGE_RULE, CARDS_PER_SHEET, type CardSize, type TableCard } from './tableCardSizes';

type Change = { enabled: boolean } | 'rotate';

export type QrMenuPanelProps = {
  marketName: string;
  /** The register's own reading of the menu's state, with its session. */
  load(): Promise<QrMenuState>;
  /** The owner's change, made with their one sign-in. */
  change(input: { email: string; password: string; change: Change }): Promise<QrMenuState>;
  onDone(message: string): void;
  /** The guest page the link points at; the public site in a release. */
  page?: string;
  copy?(text: string): Promise<void>;
  /** The browser's print window; a test stands in for it. */
  print?(): void;
};

const TITLE = 'QR menü';
const DESCRIPTION =
  'Misafir masadaki QR kodu okutur, menüyü telefonunda görür; uygulama ya da hesap gerekmez. Menü, Menü ekranındaki ürünlerden oluşur ve eşitlendikçe güncellenir.';

const NO_MENU: QrMenuState = { enabled: false, slug: null };

const failed = (error: unknown) =>
  error instanceof Error
    ? error.message
    : 'Bağlantı kurulamadı. İnternet bağlantısını kontrol edin.';

/** Settings → "QR menü": hidden in a build without a server, waiting for pairing until then. */
export function QrMenuSection({ onDone }: { onDone(message: string): void }): JSX.Element | null {
  const { settings } = useData();
  const server = SERVER;
  // Kept the same across renders: the panel reads the state again whenever `load` changes.
  const load = useCallback(
    () => (server ? readQrMenu(deviceClient(server)) : Promise.resolve(NO_MENU)),
    [server],
  );
  if (!server) {
    return null;
  }
  if (!settings.paired) {
    return (
      <SettingsSection id="qr-heading" title={TITLE} description={DESCRIPTION}>
        <p className="text-text-2">
          QR menü için önce bu cihazı sunucuya bağlayın (Bu cihaz → Sunucuya bağla).
        </p>
      </SettingsSection>
    );
  }
  return (
    <QrMenuPanel
      marketName={settings.marketName}
      load={load}
      change={(input) =>
        changeQrMenu({ owner: ownerClient(server), marketId: settings.marketId, ...input })
      }
      onDone={onDone}
    />
  );
}

type Loaded =
  | { status: 'loading' }
  | { status: 'failed'; message: string }
  | { status: 'ready'; menu: QrMenuState };

type OwnerAsk = { change: Change; title: string; description: string; confirm: string };

const DONE_MESSAGES = {
  on: 'QR menü açıldı.',
  off: 'QR menü kapatıldı.',
  rotate: 'Yeni bağlantı oluşturuldu. Masa kartlarını yeniden yazdırın.',
};

function defaultCopy(text: string): Promise<void> {
  return navigator.clipboard.writeText(text);
}

/** The QR menu's switch, link, preview, new link and table cards. */
export function QrMenuPanel({
  marketName,
  load,
  change,
  onDone,
  page = menuPageUrl(),
  copy = defaultCopy,
  print,
}: QrMenuPanelProps): JSX.Element {
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });
  const [ask, setAsk] = useState<OwnerAsk | null>(null);
  const [cards, setCards] = useState(false);

  // Read when shown; "Yeniden dene" reads again.
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    load().then(
      (menu) => live && setLoaded({ status: 'ready', menu }),
      (error: unknown) => live && setLoaded({ status: 'failed', message: failed(error) }),
    );
    return () => {
      live = false;
    };
  }, [load, attempt]);

  function read() {
    setLoaded({ status: 'loading' });
    setAttempt((count) => count + 1);
  }

  const menu = loaded.status === 'ready' ? loaded.menu : null;
  const link = menu?.slug ? menuLink(menu.slug, undefined, page) : null;

  function toggle() {
    if (!menu) {
      return;
    }
    setAsk(
      menu.enabled
        ? {
            change: { enabled: false },
            title: 'QR menüyü kapat',
            description:
              'Bağlantı ve basılı kartlar menüyü göstermez. Yeniden açınca aynı bağlantı ve kartlar çalışır.',
            confirm: 'Menüyü kapat',
          }
        : {
            change: { enabled: true },
            title: 'QR menüyü aç',
            description:
              'Misafirler restoranın adını, kategorileri, ürünleri, fiyatları, porsiyonları ve seçimleri görür. Maliyet, stok, personel ve satışlar gösterilmez.',
            confirm: 'Menüyü aç',
          },
    );
  }

  async function confirm(email: string, password: string) {
    if (!ask) {
      return;
    }
    const next = await change({ email, password, change: ask.change });
    setLoaded({ status: 'ready', menu: next });
    setAsk(null);
    onDone(
      ask.change === 'rotate'
        ? DONE_MESSAGES.rotate
        : ask.change.enabled
          ? DONE_MESSAGES.on
          : DONE_MESSAGES.off,
    );
  }

  async function copyLink() {
    if (!link) {
      return;
    }
    try {
      await copy(link);
      onDone('Bağlantı kopyalandı.');
    } catch {
      onDone('Kopyalanamadı: bağlantıyı seçip kendiniz kopyalayın.');
    }
  }

  return (
    <SettingsSection
      id="qr-heading"
      title={TITLE}
      description={DESCRIPTION}
      action={menu ? <MenuSwitch on={menu.enabled} onToggle={toggle} /> : null}
    >
      {loaded.status === 'loading' ? <p className="text-text-2">Yükleniyor…</p> : null}
      {loaded.status === 'failed' ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="flex-1 font-medium text-danger">{loaded.message}</p>
          <Button onClick={read}>Yeniden dene</Button>
        </div>
      ) : null}
      {menu ? (
        <>
          <p className={`font-medium ${menu.enabled ? 'text-success' : 'text-text-2'}`}>
            {menu.enabled
              ? 'Açık: masadaki kodu okutan misafir menüyü görür.'
              : link
                ? 'Kapalı: bağlantı ve basılı kartlar menüyü göstermez.'
                : 'Kapalı. Açınca restoranın menü bağlantısı oluşur.'}
          </p>
          {link ? (
            <>
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-0 flex-[1_1_16rem]">
                  <TextField
                    label="Menü bağlantısı"
                    readOnly
                    value={link}
                    onFocus={(event) => event.currentTarget.select()}
                    className="w-full font-mono text-meta"
                  />
                </div>
                <Button onClick={() => void copyLink()}>Kopyala</Button>
                <a
                  href={link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-touch items-center gap-2 rounded-control border border-line-strong bg-surface px-4 font-semibold whitespace-nowrap text-text transition-colors hover:bg-bg"
                >
                  <ExternalLink aria-hidden="true" size={18} />
                  Önizle
                </a>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="primary"
                  icon={<Printer aria-hidden="true" size={18} />}
                  onClick={() => setCards(true)}
                >
                  Masa kartlarını yazdır
                </Button>
                <Button
                  variant="ghost"
                  onClick={() =>
                    setAsk({
                      change: 'rotate',
                      title: 'Bağlantıyı yenile',
                      description:
                        'Yeni bir bağlantı oluşur. Eski bağlantı ve basılmış masa kartları çalışmaz; kartları yeniden yazdırmanız gerekir.',
                      confirm: 'Yeni bağlantı oluştur',
                    })
                  }
                >
                  Bağlantıyı yenile
                </Button>
              </div>
            </>
          ) : null}
        </>
      ) : null}
      {ask ? (
        <OwnerDialog
          title={ask.title}
          description={ask.description}
          confirmLabel={ask.confirm}
          danger={ask.change === 'rotate'}
          onConfirm={confirm}
          onClose={() => setAsk(null)}
        />
      ) : null}
      {cards && menu?.slug ? (
        <TableCardsDialog
          slug={menu.slug}
          marketName={marketName}
          page={page}
          onClose={() => setCards(false)}
          {...(print ? { print } : {})}
        />
      ) : null}
    </SettingsSection>
  );
}

function MenuSwitch({ on, onToggle }: { on: boolean; onToggle(): void }): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={TITLE}
      onClick={onToggle}
      className="flex min-h-touch items-center gap-3 rounded-control px-2 font-semibold"
    >
      <span
        aria-hidden="true"
        className={`flex h-7 w-12 shrink-0 items-center rounded-chip border p-0.5 transition-colors duration-150 ${
          on ? 'justify-end border-success bg-success' : 'justify-start border-line-strong bg-bg'
        }`}
      >
        <span className="size-5 rounded-chip bg-surface shadow-raised" />
      </span>
      <span aria-hidden="true" className={on ? 'text-success' : 'text-text-2'}>
        {on ? 'Açık' : 'Kapalı'}
      </span>
    </button>
  );
}

/** The owner signs in once for this one change; nothing of the sign-in stays on the device. */
function OwnerDialog({
  title,
  description,
  confirmLabel,
  danger,
  onConfirm,
  onClose,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  danger: boolean;
  onConfirm(email: string, password: string): Promise<void>;
  onClose(): void;
}): JSX.Element {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) {
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await onConfirm(email, password);
    } catch (reason) {
      setError(failed(reason));
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => !next && onClose()}
      title={title}
      description={description}
    >
      <form className="flex flex-col gap-3" onSubmit={(event) => void submit(event)}>
        <p className="text-sm text-text-2">
          Sahip hesabıyla bir kez giriş yapılır; şifre bu cihazda saklanmaz.
        </p>
        <TextField
          label="E-posta"
          type="email"
          autoComplete="off"
          spellCheck={false}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <TextField
          label="Şifre"
          type="password"
          autoComplete="off"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        {error ? (
          <p role="alert" className="font-medium text-danger">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            variant={danger ? 'danger' : 'primary'}
            disabled={busy || !email.trim() || !password}
          >
            {confirmLabel}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Vazgeç
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

const SIZES: readonly { value: CardSize; label: string }[] = [
  { value: 'sheet', label: `A4 sayfa (${CARDS_PER_SHEET} kart)` },
  { value: 'single', label: 'Tek kart (A6)' },
];

/** "Masa kartlarını yazdır": which tables, which size, a look at one card, then print. */
function TableCardsDialog({
  slug,
  marketName,
  page,
  onClose,
  print,
}: {
  slug: string;
  marketName: string;
  page: string;
  onClose(): void;
  print?(): void;
}): JSX.Element {
  const { db } = useData();
  const tables = useLiveQuery(() => listDiningTables(db), [db]);
  const [size, setSize] = useState<CardSize>('sheet');
  // Left out rather than picked, so every table is in until unticked.
  const [left, setLeft] = useState<ReadonlySet<string>>(new Set());
  const [general, setGeneral] = useState<boolean | null>(null);
  const withGeneral = general ?? tables?.length === 0;

  const cards: TableCard[] = [
    ...(tables ?? [])
      .filter((table) => !left.has(table.id))
      .map((table) => ({
        key: table.id,
        table: tableLabelIn(table, tables ?? []),
        link: menuLink(slug, tableLabelIn(table, tables ?? []), page),
      })),
    ...(withGeneral ? [{ key: 'genel', link: menuLink(slug, undefined, page) }] : []),
  ];
  const pages = Math.ceil(cards.length / (size === 'sheet' ? CARDS_PER_SHEET : 1));
  const first = cards[0];

  function flip(id: string) {
    setLeft((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function printCards() {
    printView(
      <TableCardSheet cards={cards} marketName={marketName} size={size} />,
      () => CARD_PAGE_RULE[size],
      print,
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => !next && onClose()}
      title="Masa kartları"
      description="Her kartta restoranın adı, masanın adı ve o masanın QR kodu. Kodu okutan misafir menüyü görür."
      size="lg"
      footer={
        <div className="flex flex-wrap items-center gap-3">
          <p className="mr-auto text-sm text-text-2">{`${cards.length} kart · ${pages} sayfa`}</p>
          <Button variant="primary" disabled={cards.length === 0} onClick={printCards}>
            Yazdır
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <ChoiceGroup<CardSize>
          legend="Boyut"
          name="cardSize"
          options={SIZES}
          value={size}
          onChange={setSize}
        />
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-semibold">Masalar</legend>
          {tables?.length === 0 ? (
            <p className="text-text-2">
              Henüz masa yok. Masaları Ayarlar → Masalar'dan ekleyin; şimdilik masasız genel kart
              yazdırabilirsiniz.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {(tables ?? []).map((table) => (
                <label
                  key={table.id}
                  className="flex min-h-11 cursor-pointer items-center gap-2 rounded-chip border border-line-strong bg-surface px-3 font-medium has-checked:border-text"
                >
                  <input
                    type="checkbox"
                    className="size-5 accent-[var(--color-accent)]"
                    checked={!left.has(table.id)}
                    onChange={() => flip(table.id)}
                    aria-label={tableLabelIn(table, tables ?? [])}
                  />
                  <span aria-hidden="true">{tableLabel(tableLabelIn(table, tables ?? []))}</span>
                </label>
              ))}
            </div>
          )}
          <label className="flex min-h-11 cursor-pointer items-center gap-2 self-start font-medium">
            <input
              type="checkbox"
              className="size-5 accent-[var(--color-accent)]"
              checked={withGeneral}
              onChange={(event) => setGeneral(event.target.checked)}
            />
            Genel kart (masasız)
          </label>
        </fieldset>
        {first ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-semibold">Önizleme</p>
            <div className="overflow-x-auto rounded-plate border border-line bg-bg p-3">
              <div className="mx-auto w-fit shadow-raised max-sm:[zoom:0.7]">
                <TableCardPreview card={first} marketName={marketName} size={size} />
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
