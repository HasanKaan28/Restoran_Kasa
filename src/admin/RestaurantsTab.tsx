import { useEffect, useState, type JSX } from 'react';
import { Button, ChoiceGroup, SelectField, TextField } from '@/design';
import type { OperatorApi, Restaurant } from './api';
import { dayText, lastSeenText, licenseText, MAX_DAYS, PERIODS, PLANS, type PlanId } from './model';

/** A sold period in days, or a number of days typed in. */
type Period = number | 'custom';

const failed = (error: unknown) =>
  error instanceof Error ? error.message : 'Bağlantı kurulamadı.';

const TONES = { ok: 'text-success', warning: 'text-warning', danger: 'text-danger' } as const;
const EDGES = { ok: 'edge-ready', warning: 'edge-bill', danger: 'edge-late' } as const;

/** Every restaurant with its plan, licence and registers; the seller extends or changes them. */
export function RestaurantsTab({
  api,
  now = () => new Date(),
}: {
  api: OperatorApi;
  now?: () => Date;
}): JSX.Element {
  const [restaurants, setRestaurants] = useState<Restaurant[]>();
  const [error, setError] = useState<string>();

  // Bumped to read the list again: after a change, or "Yenile".
  const [version, setVersion] = useState(0);
  const reload = () => setVersion((now) => now + 1);

  useEffect(() => {
    let live = true;
    api.listRestaurants().then(
      (list) => {
        if (live) {
          setRestaurants(list);
          setError(undefined);
        }
      },
      (reason: unknown) => live && setError(failed(reason)),
    );
    return () => {
      live = false;
    };
  }, [api, version]);

  return (
    <section aria-labelledby="restaurants" className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <h2 id="restaurants" className="text-title font-semibold">
          Restoranlar
        </h2>
        <Button variant="ghost" className="ml-auto" onClick={reload}>
          Yenile
        </Button>
      </div>
      {error ? (
        <p role="alert" className="font-medium text-danger">
          {error}
        </p>
      ) : null}
      {restaurants === undefined && !error ? (
        <p role="status" className="text-text-2">
          Yükleniyor…
        </p>
      ) : null}
      {restaurants?.length === 0 ? <p className="text-text-2">Henüz restoran yok.</p> : null}
      {restaurants && restaurants.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {restaurants.map((restaurant) => (
            <RestaurantRow
              key={restaurant.id}
              restaurant={restaurant}
              api={api}
              now={now()}
              onChanged={reload}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function RestaurantRow({
  restaurant,
  api,
  now,
  onChanged,
}: {
  restaurant: Restaurant;
  api: OperatorApi;
  now: Date;
  onChanged(): void;
}): JSX.Element {
  const [open, setOpen] = useState<'extend' | 'plan' | null>(null);
  const license = licenseText(restaurant.licenseExpiresAt, now);
  const devices =
    restaurant.maxDevices === null
      ? `${restaurant.devices} cihaz · sınırsız`
      : `${restaurant.devices} / ${restaurant.maxDevices} cihaz`;
  const toggle = (next: 'extend' | 'plan') => setOpen((now) => (now === next ? null : next));

  return (
    <li className={`slip ${EDGES[license.tone]} flex flex-col gap-2 px-4 py-3`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="font-display text-label font-semibold">{restaurant.name}</h3>
        <span className="rounded-chip bg-bg px-2.5 py-0.5 text-meta font-semibold text-text-2">
          {restaurant.planName}
        </span>
      </div>
      {restaurant.ownerEmail ? (
        <p className="truncate text-sm text-text-2">{restaurant.ownerEmail}</p>
      ) : null}
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-sm">
        <dt className="text-muted">Lisans</dt>
        <dd className={`font-medium ${TONES[license.tone]}`}>
          {license.text}
          {restaurant.licenseExpiresAt ? (
            <span className="font-normal text-text-2">
              {' '}
              · {dayText(restaurant.licenseExpiresAt)}
            </span>
          ) : null}
        </dd>
        <dt className="text-muted">Cihaz</dt>
        <dd>{devices}</dd>
        <dt className="text-muted">Son görülme</dt>
        <dd>{lastSeenText(restaurant.lastSeenAt, now)}</dd>
        <dt className="text-muted">Açılış</dt>
        <dd>{dayText(restaurant.createdAt)}</dd>
      </dl>
      <div className="flex flex-wrap gap-2 pt-1">
        <Button aria-expanded={open === 'extend'} onClick={() => toggle('extend')}>
          Süre uzat
        </Button>
        <Button aria-expanded={open === 'plan'} onClick={() => toggle('plan')}>
          Paket değiştir
        </Button>
      </div>
      {open === 'extend' ? (
        restaurant.licenseExpiresAt === null ? (
          <p className="text-sm text-text-2">Bu restoranın lisansı süresiz; uzatmaya gerek yok.</p>
        ) : (
          <ExtendForm
            restaurant={restaurant}
            api={api}
            onDone={() => {
              setOpen(null);
              onChanged();
            }}
          />
        )
      ) : null}
      {open === 'plan' ? (
        <PlanForm
          restaurant={restaurant}
          api={api}
          onDone={() => {
            setOpen(null);
            onChanged();
          }}
        />
      ) : null}
    </li>
  );
}

function ExtendForm({
  restaurant,
  api,
  onDone,
}: {
  restaurant: Restaurant;
  api: OperatorApi;
  onDone(): void;
}): JSX.Element {
  const [period, setPeriod] = useState<Period>(365);
  const [customDays, setCustomDays] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function extend() {
    const days = period === 'custom' ? Number(customDays) : period;
    if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
      setError(`Süre 1 ile ${MAX_DAYS} gün arasında olmalı.`);
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await api.extendLicense(restaurant.id, days);
      onDone();
    } catch (reason) {
      setError(failed(reason));
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-control border border-line bg-bg p-3">
      <ChoiceGroup<Period>
        legend="Eklenecek süre"
        name={`extend-${restaurant.id}`}
        wrap
        value={period}
        onChange={setPeriod}
        options={[
          ...PERIODS.filter((item) => item.days !== 14).map((item) => ({
            value: item.days,
            label: item.label,
          })),
          { value: 'custom', label: 'Özel' },
        ]}
      />
      {period === 'custom' ? (
        <TextField
          label="Gün sayısı"
          type="number"
          inputMode="numeric"
          value={customDays}
          onChange={(event) => setCustomDays(event.target.value)}
        />
      ) : null}
      <p className="text-meta text-muted">Süre bitmediyse bitiş gününe, bittiyse bugüne eklenir.</p>
      {error ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
      <Button variant="primary" disabled={busy} onClick={() => void extend()}>
        Süreyi uzat
      </Button>
    </div>
  );
}

function PlanForm({
  restaurant,
  api,
  onDone,
}: {
  restaurant: Restaurant;
  api: OperatorApi;
  onDone(): void;
}): JSX.Element {
  const [plan, setPlan] = useState<PlanId>(restaurant.plan);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setError(undefined);
    try {
      await api.setPlan(restaurant.id, plan);
      onDone();
    } catch (reason) {
      setError(failed(reason));
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-control border border-line bg-bg p-3">
      <SelectField
        label="Paket"
        value={plan}
        onChange={(event) => setPlan(event.target.value as PlanId)}
        options={PLANS.map((item) => ({ value: item.id, label: `${item.name} · ${item.devices}` }))}
      />
      <p className="text-meta text-muted">
        Küçük bir pakete geçince bağlı cihazlar çalışmaya devam eder; yalnız yeni cihaz eklenemez.
      </p>
      {error ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
      <Button
        variant="primary"
        disabled={busy || plan === restaurant.plan}
        onClick={() => void save()}
      >
        Paketi kaydet
      </Button>
    </div>
  );
}
