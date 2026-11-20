import { ArrowLeft, ExternalLink } from 'lucide-react';
import { useState, type FormEvent, type JSX, type ReactNode } from 'react';
import { Button, TextField } from '@/design';
import { menuLink } from '@/server/qrMenu';
import type { Device, OperatorApi, RestaurantDetail as Detail } from './api';
import {
  actionDetail,
  actionLabel,
  bytesText,
  countText,
  dateTimeText,
  dayInTurkey,
  dayText,
  devicesText,
  endOfTurkishDay,
  lastSeenText,
  licenseText,
  platformLabel,
  statusText,
  tableLabel,
} from './model';
import { ExtendForm, PlanForm } from './RestaurantsTab';
import { CHIPS, failed, TONES, useLoad } from './load';
import { Alert, ConfirmDialog, CopyButton, Loading, Panel, TextArea } from './ui';

/**
 * One restaurant, as the seller looks after it: what it is and how it is used (counts only), its
 * registers, licence, limits, QR menu, a private note, the last changes made to it, and the
 * actions that are hard to take back behind a confirmation.
 */
export function RestaurantDetail({
  api,
  marketId,
  onBack,
  now = () => new Date(),
}: {
  api: OperatorApi;
  marketId: string;
  onBack(): void;
  now?: () => Date;
}): JSX.Element {
  const detail = useLoad(() => api.restaurant(marketId), `detail:${marketId}`);
  const history = useLoad(() => api.history({ limit: 10, marketId }), `history:${marketId}`);
  const changed = () => {
    detail.reload();
    history.reload();
  };
  const data = detail.data;

  return (
    <article aria-labelledby="restaurant-name" className="flex flex-col gap-4">
      <div>
        <Button
          variant="ghost"
          className="-ml-3"
          icon={<ArrowLeft aria-hidden="true" size={18} strokeWidth={1.75} />}
          onClick={onBack}
        >
          Geri
        </Button>
      </div>
      {detail.error ? <Alert>{detail.error}</Alert> : null}
      {data === undefined && !detail.error ? <Loading /> : null}
      {data ? (
        <>
          <Heading detail={data} />
          <Info detail={data} now={now()} />
          <Usage detail={data} />
          <Devices detail={data} api={api} now={now()} onChanged={changed} />
          <License detail={data} api={api} now={now()} onChanged={changed} />
          <QrMenu detail={data} api={api} onChanged={changed} />
          <Note detail={data} api={api} onChanged={changed} />
          <Rename detail={data} api={api} onChanged={changed} />
          <Panel title="Son işlemler" id="restaurant-history">
            {history.error ? <Alert>{history.error}</Alert> : null}
            {history.data?.length === 0 ? (
              <p className="text-sm text-text-2">Bu restoranda henüz işlem yapılmadı.</p>
            ) : null}
            <ul className="flex flex-col divide-y divide-line">
              {history.data?.map((entry) => (
                <li key={entry.id} className="flex flex-col gap-0.5 py-2 text-sm">
                  <span className="font-medium">{actionLabel(entry.action)}</span>
                  {actionDetail(entry.action, entry.details) ? (
                    <span className="break-words text-text-2">
                      {actionDetail(entry.action, entry.details)}
                    </span>
                  ) : null}
                  <span className="text-meta text-muted">{dateTimeText(entry.at)}</span>
                </li>
              ))}
            </ul>
          </Panel>
          <Danger detail={data} api={api} onChanged={changed} />
        </>
      ) : null}
    </article>
  );
}

function Heading({ detail }: { detail: Detail }): JSX.Element {
  const state = statusText(detail.status, detail.deletedAt);
  return (
    <div className="flex flex-col gap-2">
      <h2 id="restaurant-name" className="text-title font-semibold break-words">
        {detail.name}
      </h2>
      <div className="flex flex-wrap gap-2">
        <span className={`rounded-chip px-2.5 py-0.5 text-meta font-semibold ${CHIPS[state.tone]}`}>
          {state.text}
        </span>
        <span className="rounded-chip bg-surface px-2.5 py-0.5 text-meta font-semibold text-text-2">
          {detail.planName}
        </span>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  );
}

function Info({ detail, now }: { detail: Detail; now: Date }): JSX.Element {
  const license = licenseText(detail.licenseExpiresAt, now);
  const live = detail.devices.filter((device) => device.revokedAt === null).length;
  return (
    <Panel title="Bilgiler" id="restaurant-info">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        <Row label="Sahip">{detail.ownerEmail ?? 'Hesap bağlı değil'}</Row>
        <Row label="Paket">{detail.planName}</Row>
        <Row label="Lisans">
          <span className={`font-medium ${TONES[license.tone]}`}>{license.text}</span>
          {detail.licenseExpiresAt ? (
            <span className="text-text-2"> · {dayText(detail.licenseExpiresAt)}</span>
          ) : null}
        </Row>
        <Row label="Cihaz">
          {devicesText(live, detail.maxDevices)}
          {detail.maxDevicesOverride !== null ? (
            <span className="text-text-2"> · özel sınır</span>
          ) : null}
        </Row>
        <Row label="Açılış">{dayText(detail.createdAt)}</Row>
        <Row label="Son eşitleme">{lastSeenText(detail.lastSyncAt, now)}</Row>
        <Row label="Kimlik">
          <span className="font-mono text-meta">{detail.id}</span>
        </Row>
      </dl>
    </Panel>
  );
}

function Usage({ detail }: { detail: Detail }): JSX.Element {
  const { bytes, limitBytes } = detail.storage;
  const share = limitBytes > 0 ? Math.min(1, bytes / limitBytes) : 0;
  const figures = [
    { label: 'Satış', value: detail.activity.sales },
    { label: 'Adisyon', value: detail.activity.tabs },
    { label: 'Aktif cihaz', value: detail.activity.activeDevices },
  ];
  return (
    <Panel title="Kullanım · son 30 gün" id="restaurant-usage">
      <dl className="grid grid-cols-3 gap-2">
        {figures.map((figure) => (
          <div
            key={figure.label}
            className="flex flex-col-reverse gap-0.5 rounded-control bg-bg px-3 py-2"
          >
            <dt className="text-meta text-text-2">{figure.label}</dt>
            <dd className="font-display text-xl font-semibold tabular-nums">
              {countText(figure.value)}
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-meta text-muted">
        Yalnız sayılar gösterilir; satış, adisyon ya da müşteri ayrıntısı bu sayfaya gelmez.
      </p>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <span className="font-semibold">Depolama</span>
          <span className="text-text-2 tabular-nums">
            {`${bytesText(bytes)} / ${bytesText(limitBytes)}`}
          </span>
        </div>
        <div
          role="meter"
          aria-label="Depolama"
          aria-valuemin={0}
          aria-valuemax={limitBytes}
          aria-valuenow={bytes}
          className="h-2 overflow-hidden rounded-chip bg-bg"
        >
          <div
            className={`h-full rounded-chip ${share > 0.9 ? 'bg-danger' : share > 0.7 ? 'bg-warning' : 'bg-accent'}`}
            style={{ width: `${Math.max(share * 100, bytes > 0 ? 2 : 0)}%` }}
          />
        </div>
      </div>
      {detail.rowCounts.length > 0 ? (
        <details className="group text-sm">
          <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-text-2 hover:text-text">
            Kayıt sayıları
          </summary>
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 pt-1">
            {detail.rowCounts.map((row) => (
              <div key={row.table} className="contents">
                <dt className="text-text-2">{tableLabel(row.table)}</dt>
                <dd className="text-right tabular-nums">{countText(row.count)}</dd>
              </div>
            ))}
          </dl>
        </details>
      ) : (
        <p className="text-sm text-text-2">Henüz eşitlenmiş kayıt yok.</p>
      )}
    </Panel>
  );
}

function Devices({
  detail,
  api,
  now,
  onChanged,
}: {
  detail: Detail;
  api: OperatorApi;
  now: Date;
  onChanged(): void;
}): JSX.Element {
  return (
    <Panel title="Cihazlar" id="restaurant-devices">
      {detail.devices.length === 0 ? (
        <p className="text-sm text-text-2">Bu restorana bağlı cihaz yok.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {detail.devices.map((device) => (
            <DeviceRow key={device.id} device={device} api={api} now={now} onChanged={onChanged} />
          ))}
        </ul>
      )}
      <Pairing detail={detail} api={api} />
    </Panel>
  );
}

function DeviceRow({
  device,
  api,
  now,
  onChanged,
}: {
  device: Device;
  api: OperatorApi;
  now: Date;
  onChanged(): void;
}): JSX.Element {
  const [renaming, setRenaming] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [name, setName] = useState(device.name);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const revoked = device.revokedAt !== null;

  async function rename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await api.renameDevice(device.id, name);
      setRenaming(false);
      onChanged();
    } catch (reason) {
      setError(failed(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li
      aria-label={`${device.code} · ${device.name}`}
      className={`flex flex-col gap-1.5 rounded-control border border-line px-3 py-2.5 ${revoked ? 'bg-bg' : ''}`}
    >
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <span className="rounded-chip bg-text px-2 py-0.5 font-mono text-meta font-medium text-bg">
          {device.code}
        </span>
        <span className={`font-semibold ${revoked ? 'text-text-2 line-through' : ''}`}>
          {device.name}
        </span>
        {revoked ? (
          <span className="rounded-chip bg-surface px-2 py-0.5 text-meta font-semibold text-text-2">
            İptal edildi
          </span>
        ) : null}
      </div>
      <p className="text-meta text-text-2">
        {`${platformLabel(device.platform)} · eklendi ${dayText(device.createdAt)} · ${
          revoked && device.revokedAt
            ? `iptal ${dayText(device.revokedAt)}`
            : `son görülme ${lastSeenText(device.lastSeenAt, now).toLocaleLowerCase('tr')}`
        }`}
      </p>
      {revoked ? null : renaming ? (
        <form className="flex flex-col gap-2 pt-1" onSubmit={(event) => void rename(event)}>
          <TextField
            label="Cihaz adı"
            maxLength={60}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          {error ? <Alert>{error}</Alert> : null}
          <div className="flex gap-2">
            <Button type="submit" variant="primary" disabled={busy || name.trim() === ''}>
              Adı kaydet
            </Button>
            <Button variant="ghost" onClick={() => setRenaming(false)}>
              Vazgeç
            </Button>
          </div>
        </form>
      ) : (
        <div className="-ml-2 flex flex-wrap gap-1">
          <Button variant="ghost" onClick={() => setRenaming(true)}>
            Adını değiştir
          </Button>
          <Button variant="ghost" className="text-danger" onClick={() => setRevoking(true)}>
            Cihazı iptal et…
          </Button>
        </div>
      )}
      <ConfirmDialog
        open={revoking}
        title="Cihaz iptal edilsin mi?"
        description={`${device.code} · ${device.name} bir sonraki eşitlemede reddedilir ve yeniden bağlanana kadar eşitlenmez. Cihazdaki kayıtlar silinmez.`}
        confirmLabel="Cihazı iptal et"
        onClose={() => setRevoking(false)}
        onConfirm={async () => {
          await api.revokeDevice(device.id);
          onChanged();
        }}
      />
    </li>
  );
}

function Pairing({ detail, api }: { detail: Detail; api: OperatorApi }): JSX.Element {
  const [made, setMade] = useState<{ code: string; expiresAt: string }>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const live = detail.devices.filter((device) => device.revokedAt === null).length;
  const full = detail.maxDevices !== null && live >= detail.maxDevices;

  async function make() {
    setBusy(true);
    setError(undefined);
    try {
      setMade(await api.createPairing(detail.id));
    } catch (reason) {
      setError(failed(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 border-t border-line pt-3">
      <p className="text-sm font-semibold">Destek için bağlantı kodu</p>
      <p className="text-meta text-muted">
        Müşterinin cihazında Ayarlar → Sunucuya bağla → “Bağlantı kodu” alanına girilir; cihaz bu
        restorana bağlanır. 10 dakika geçerli, bir kez kullanılır.
      </p>
      {full ? (
        <p className="text-sm text-warning">
          Cihaz sınırı dolu: kod yeni bir cihazı bağlamaz. Önce bir cihazı iptal edin ya da sınırı
          artırın.
        </p>
      ) : null}
      {made ? (
        <div
          role="status"
          aria-label="Bağlantı kodu"
          className="slip edge-open flex flex-col gap-2 p-3"
        >
          <p className="font-mono text-2xl font-medium tracking-[0.2em] select-all">{made.code}</p>
          <p className="text-meta text-text-2">{`Son geçerlilik: ${dateTimeText(made.expiresAt)}`}</p>
          <CopyButton text={made.code} />
        </div>
      ) : null}
      {error ? <Alert>{error}</Alert> : null}
      <Button disabled={busy} onClick={() => void make()}>
        {made ? 'Yeni kod üret' : 'Bağlantı kodu üret'}
      </Button>
    </div>
  );
}

function License({
  detail,
  api,
  now,
  onChanged,
}: {
  detail: Detail;
  api: OperatorApi;
  now: Date;
  onChanged(): void;
}): JSX.Element {
  const [open, setOpen] = useState<'extend' | 'date' | 'plan' | 'limit' | null>(null);
  const toggle = (next: NonNullable<typeof open>) => setOpen((now) => (now === next ? null : next));
  const done = () => {
    setOpen(null);
    onChanged();
  };
  const license = licenseText(detail.licenseExpiresAt, now);

  return (
    <Panel title="Lisans ve paket" id="restaurant-license">
      <p className="text-sm">
        <span className={`font-medium ${TONES[license.tone]}`}>{license.text}</span>
        {detail.licenseExpiresAt ? (
          <span className="text-text-2"> · bitiş {dayText(detail.licenseExpiresAt)}</span>
        ) : null}
      </p>
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        <Button
          aria-expanded={open === 'extend'}
          disabled={detail.licenseExpiresAt === null}
          onClick={() => toggle('extend')}
        >
          Süre uzat
        </Button>
        <Button aria-expanded={open === 'date'} onClick={() => toggle('date')}>
          Bitiş tarihi
        </Button>
        <Button aria-expanded={open === 'plan'} onClick={() => toggle('plan')}>
          Paket değiştir
        </Button>
        <Button aria-expanded={open === 'limit'} onClick={() => toggle('limit')}>
          Cihaz sınırı
        </Button>
      </div>
      {open === 'extend' ? <ExtendForm marketId={detail.id} api={api} onDone={done} /> : null}
      {open === 'date' ? <DateForm detail={detail} api={api} now={now} onDone={done} /> : null}
      {open === 'plan' ? (
        <PlanForm marketId={detail.id} current={detail.plan} api={api} onDone={done} />
      ) : null}
      {open === 'limit' ? <LimitForm detail={detail} api={api} onDone={done} /> : null}
    </Panel>
  );
}

/** Sets the licence's last day directly; an earlier end or no end at all is confirmed first. */
function DateForm({
  detail,
  api,
  now,
  onDone,
}: {
  detail: Detail;
  api: OperatorApi;
  now: Date;
  onDone(): void;
}): JSX.Element {
  const [day, setDay] = useState(
    dayInTurkey(detail.licenseExpiresAt ?? new Date(now.getTime() + 30 * 86_400_000).toISOString()),
  );
  const [asking, setAsking] = useState<{ end: string | null } | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function save(end: string | null) {
    setBusy(true);
    setError(undefined);
    try {
      await api.setLicense(detail.id, end);
      onDone();
    } catch (reason) {
      setError(failed(reason));
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      setError('Bir gün seçin.');
      return;
    }
    const end = endOfTurkishDay(day);
    const shorter =
      detail.licenseExpiresAt === null || Date.parse(end) < Date.parse(detail.licenseExpiresAt);
    if (shorter) {
      setAsking({ end });
    } else {
      void save(end);
    }
  }

  const askedEnd = asking?.end ?? null;
  const endsNow = askedEnd !== null && Date.parse(askedEnd) <= now.getTime();

  return (
    <form
      className="flex flex-col gap-3 rounded-control border border-line bg-bg p-3"
      onSubmit={submit}
    >
      <TextField
        label="Lisansın son günü"
        type="date"
        required
        value={day}
        onChange={(event) => setDay(event.target.value)}
      />
      <p className="text-meta text-muted">
        Lisans o günün sonunda (Türkiye saatiyle) biter; sonrasında 7 gün daha eşitleme açık kalır.
      </p>
      {error ? <Alert>{error}</Alert> : null}
      <div className="grid gap-2 sm:flex">
        <Button type="submit" variant="primary" disabled={busy}>
          Tarihi kaydet
        </Button>
        {detail.licenseExpiresAt !== null ? (
          <Button disabled={busy} onClick={() => setAsking({ end: null })}>
            Süresiz yap…
          </Button>
        ) : null}
      </div>
      <ConfirmDialog
        open={asking !== null}
        title={askedEnd === null ? 'Lisans süresiz yapılsın mı?' : 'Lisans kısaltılsın mı?'}
        description={
          askedEnd === null
            ? 'Bu restoranın lisansı hiç bitmez; süre uzatma gerekmez. İstediğinizde yeniden tarih koyabilirsiniz.'
            : endsNow
              ? `Yeni bitiş ${dayText(askedEnd)}: lisans hemen biter, 7 gün sonra eşitleme durur.`
              : `Yeni bitiş ${dayText(askedEnd)}${detail.licenseExpiresAt ? `; şimdiki bitiş ${dayText(detail.licenseExpiresAt)}` : '; şu an süresiz'}.`
        }
        confirmLabel={askedEnd === null ? 'Süresiz yap' : 'Kısalt'}
        danger={askedEnd !== null}
        onClose={() => setAsking(null)}
        onConfirm={async () => {
          await api.setLicense(detail.id, askedEnd);
          onDone();
        }}
      />
    </form>
  );
}

function LimitForm({
  detail,
  api,
  onDone,
}: {
  detail: Detail;
  api: OperatorApi;
  onDone(): void;
}): JSX.Element {
  const [value, setValue] = useState(
    String(detail.maxDevicesOverride ?? detail.planMaxDevices ?? ''),
  );
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const planLimit = detail.planMaxDevices === null ? 'sınırsız' : `${detail.planMaxDevices} cihaz`;

  async function save(limit: number | null) {
    setBusy(true);
    setError(undefined);
    try {
      await api.setMaxDevices(detail.id, limit);
      onDone();
    } catch (reason) {
      setError(failed(reason));
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const limit = Number(value);
    if (!Number.isInteger(limit) || limit < 1 || limit > 999) {
      setError('Cihaz sınırı 1 ile 999 arasında olmalı.');
      return;
    }
    void save(limit);
  }

  return (
    <form
      className="flex flex-col gap-3 rounded-control border border-line bg-bg p-3"
      onSubmit={submit}
    >
      <TextField
        label="Bu restorana özel cihaz sınırı"
        type="number"
        inputMode="numeric"
        min={1}
        max={999}
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <p className="text-meta text-muted">
        {`Paketin sınırı: ${planLimit}. Sınırı düşürmek bağlı cihazları kapatmaz; yalnız yeni cihaz eklenemez.`}
      </p>
      {error ? <Alert>{error}</Alert> : null}
      <div className="grid gap-2 sm:flex">
        <Button type="submit" variant="primary" disabled={busy}>
          Sınırı kaydet
        </Button>
        {detail.maxDevicesOverride !== null ? (
          <Button disabled={busy} onClick={() => void save(null)}>
            Paketin sınırına dön
          </Button>
        ) : null}
      </div>
    </form>
  );
}

function QrMenu({
  detail,
  api,
  onChanged,
}: {
  detail: Detail;
  api: OperatorApi;
  onChanged(): void;
}): JSX.Element {
  const [rotating, setRotating] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const menu = detail.qrMenu;
  const link = menu ? menuLink(menu.slug) : null;

  async function toggle(enabled: boolean) {
    setBusy(true);
    setError(undefined);
    try {
      await api.setQrMenu(detail.id, enabled);
      onChanged();
    } catch (reason) {
      setError(failed(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="QR menü" id="restaurant-qr">
      <p className="text-sm">
        {menu === null ? (
          <span className="text-text-2">Hiç açılmadı.</span>
        ) : menu.enabled ? (
          <span className="font-medium text-success">Açık: misafirler menüyü görebilir.</span>
        ) : (
          <span className="font-medium text-text-2">Kapalı.</span>
        )}
      </p>
      {link && menu?.enabled ? (
        <div className="flex flex-col gap-2">
          <p className="rounded-control bg-bg px-3 py-2 font-mono text-meta break-all select-all">
            {link}
          </p>
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <CopyButton text={link} label="Bağlantıyı kopyala" />
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-touch items-center justify-center gap-2 rounded-control border border-line-strong bg-surface px-4 font-semibold text-text transition-colors hover:bg-bg"
            >
              <ExternalLink aria-hidden="true" size={18} strokeWidth={1.75} />
              Aç
            </a>
          </div>
        </div>
      ) : null}
      {error ? <Alert>{error}</Alert> : null}
      <div className="grid gap-2 sm:flex">
        <Button disabled={busy} onClick={() => void toggle(!(menu?.enabled ?? false))}>
          {menu?.enabled ? 'QR menüyü kapat' : 'QR menüyü aç'}
        </Button>
        {menu ? (
          <Button variant="ghost" disabled={busy} onClick={() => setRotating(true)}>
            Yeni bağlantı…
          </Button>
        ) : null}
      </div>
      <ConfirmDialog
        open={rotating}
        title="QR menüye yeni bağlantı verilsin mi?"
        description="Eski bağlantı ve onunla basılmış bütün masa kartları hemen çalışmaz olur; kartların yeniden basılması gerekir."
        confirmLabel="Yeni bağlantı ver"
        onClose={() => setRotating(false)}
        onConfirm={async () => {
          await api.rotateQrMenu(detail.id);
          onChanged();
        }}
      />
    </Panel>
  );
}

function Note({
  detail,
  api,
  onChanged,
}: {
  detail: Detail;
  api: OperatorApi;
  onChanged(): void;
}): JSX.Element {
  const [note, setNote] = useState(detail.note ?? '');
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    setSaved(false);
    try {
      await api.setNote(detail.id, note);
      setSaved(true);
      onChanged();
    } catch (reason) {
      setError(failed(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Özel not" id="restaurant-note">
      <form className="flex flex-col gap-3" onSubmit={(event) => void save(event)}>
        <TextArea
          label="Not"
          hint="Yalnız siz görürsünüz; restoran ve cihazları görmez."
          maxLength={2000}
          value={note}
          onChange={(event) => {
            setNote(event.target.value);
            setSaved(false);
          }}
        />
        {error ? <Alert>{error}</Alert> : null}
        {saved ? (
          <p role="status" className="text-sm font-medium text-success">
            Not kaydedildi.
          </p>
        ) : null}
        <Button
          type="submit"
          variant="primary"
          disabled={busy || note.trim() === (detail.note ?? '')}
        >
          Notu kaydet
        </Button>
      </form>
    </Panel>
  );
}

function Rename({
  detail,
  api,
  onChanged,
}: {
  detail: Detail;
  api: OperatorApi;
  onChanged(): void;
}): JSX.Element {
  const [name, setName] = useState(detail.name);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await api.renameRestaurant(detail.id, name);
      onChanged();
    } catch (reason) {
      setError(failed(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Restoran adı" id="restaurant-rename">
      <form className="flex flex-col gap-3" onSubmit={(event) => void save(event)}>
        <TextField
          label="Ad"
          maxLength={60}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <p className="text-meta text-muted">Cihazlar yeni adı bir sonraki açılışta gösterir.</p>
        {error ? <Alert>{error}</Alert> : null}
        <Button type="submit" disabled={busy || name.trim() === '' || name.trim() === detail.name}>
          Adı kaydet
        </Button>
      </form>
    </Panel>
  );
}

function Danger({
  detail,
  api,
  onChanged,
}: {
  detail: Detail;
  api: OperatorApi;
  onChanged(): void;
}): JSX.Element {
  const [asking, setAsking] = useState<'suspend' | 'delete' | null>(null);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const deleted = detail.deletedAt !== null;
  const suspended = detail.status !== 'active';
  const matches =
    typed.trim().toLocaleLowerCase('tr') === detail.name.trim().toLocaleLowerCase('tr');

  async function activate() {
    setBusy(true);
    setError(undefined);
    try {
      await api.setStatus(detail.id, 'active');
      onChanged();
    } catch (reason) {
      setError(failed(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby="restaurant-danger"
      className="flex flex-col gap-3 rounded-plate border border-danger/40 bg-surface p-4"
    >
      <h3 id="restaurant-danger" className="font-display text-label font-semibold text-danger">
        Durum
      </h3>
      {deleted ? (
        <p className="text-sm text-text-2">
          {`${dayText(detail.deletedAt as string)} tarihinde silindi. Veriler duruyor; geri getirince restoran kaldığı yerden sürer.`}
        </p>
      ) : suspended ? (
        <p className="text-sm text-text-2">
          Askıda: cihazlar eşitlenmiyor, QR menü kapalı. Etkinleştirince kaldığı yerden sürer.
        </p>
      ) : (
        <p className="text-sm text-text-2">Etkin: cihazlar eşitleniyor.</p>
      )}
      {error ? <Alert>{error}</Alert> : null}
      <div className="grid gap-2 sm:flex">
        {suspended ? (
          <Button variant="primary" disabled={busy} onClick={() => void activate()}>
            {deleted ? 'Geri getir' : 'Etkinleştir'}
          </Button>
        ) : (
          <Button variant="danger" onClick={() => setAsking('suspend')}>
            Askıya al…
          </Button>
        )}
        {deleted ? null : (
          <Button
            variant="ghost"
            className="text-danger"
            onClick={() => {
              setTyped('');
              setAsking('delete');
            }}
          >
            Restoranı sil…
          </Button>
        )}
      </div>
      <ConfirmDialog
        open={asking === 'suspend'}
        title="Restoran askıya alınsın mı?"
        description="Cihazlar eşitlenemez, yeni cihaz bağlanamaz, QR menü kapanır. Kayıtlar cihazlarda ve sunucuda kalır; etkinleştirince her şey kaldığı yerden sürer."
        confirmLabel="Askıya al"
        onClose={() => setAsking(null)}
        onConfirm={async () => {
          await api.setStatus(detail.id, 'suspended');
          onChanged();
        }}
      />
      <ConfirmDialog
        open={asking === 'delete'}
        title="Restoran silinsin mi?"
        description="Restoran askıya alınır ve silinmiş olarak işaretlenir; listelerde gizlenir. Hiçbir veri silinmez, “Geri getir” ile geri alınabilir."
        confirmLabel="Restoranı sil"
        disabled={!matches}
        onClose={() => setAsking(null)}
        onConfirm={async () => {
          await api.deleteRestaurant(detail.id, typed);
          onChanged();
        }}
      >
        <TextField
          label="Onay için restoranın adını yazın"
          hint={detail.name}
          autoComplete="off"
          spellCheck={false}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
        />
      </ConfirmDialog>
    </section>
  );
}
