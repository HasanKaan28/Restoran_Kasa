import { ChevronRight, Search } from 'lucide-react';
import { useState, type JSX } from 'react';
import { Button, ChoiceGroup, SelectField, TextField } from '@/design';
import type { Activity, OperatorApi, Restaurant } from './api';
import {
  activityText,
  dayText,
  devicesText,
  lastSeenText,
  licenseText,
  MAX_DAYS,
  PERIODS,
  PLANS,
  statusText,
  type PlanId,
} from './model';
import { CHIPS, failed, TONES, useLoad } from './load';
import { Alert, Loading } from './ui';

/** A sold period in days, or a number of days typed in. */
type Period = number | 'custom';

const EDGES = { ok: 'edge-ready', warning: 'edge-bill', danger: 'edge-late' } as const;

/** Every restaurant with its plan, licence and registers; the seller extends or changes them. */
export function RestaurantsTab({
  api,
  onOpen,
  now = () => new Date(),
}: {
  api: OperatorApi;
  onOpen(marketId: string): void;
  now?: () => Date;
}): JSX.Element {
  const { data, error, reload } = useLoad(
    () => Promise.all([api.listRestaurants(), api.activity().catch(() => [])]),
    'restaurants',
  );
  const [query, setQuery] = useState('');
  const [showDeleted, setShowDeleted] = useState(false);
  const restaurants = data?.[0];
  const activity = new Map(data?.[1].map((row) => [row.id, row]));
  const needle = query.trim().toLocaleLowerCase('tr');
  const deleted = restaurants?.filter((item) => item.deletedAt !== null).length ?? 0;
  const shown = restaurants?.filter(
    (item) =>
      (showDeleted || item.deletedAt === null) &&
      (needle === '' ||
        item.name.toLocaleLowerCase('tr').includes(needle) ||
        (item.ownerEmail ?? '').toLocaleLowerCase('tr').includes(needle)),
  );

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
      {error ? <Alert>{error}</Alert> : null}
      {restaurants === undefined && !error ? <Loading /> : null}
      {restaurants?.length === 0 ? <p className="text-text-2">Henüz restoran yok.</p> : null}
      {restaurants && restaurants.length > 0 ? (
        <>
          <div className="relative">
            <TextField
              label="Restoran ara"
              type="search"
              placeholder="Ad ya da e-posta"
              className="w-full pl-10"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <Search
              aria-hidden="true"
              size={18}
              className="pointer-events-none absolute bottom-[15px] left-3.5 text-muted"
            />
          </div>
          {deleted > 0 ? (
            <label className="flex min-h-11 items-center gap-2 text-sm text-text-2">
              <input
                type="checkbox"
                className="size-4 accent-accent"
                checked={showDeleted}
                onChange={(event) => setShowDeleted(event.target.checked)}
              />
              {`Silinenleri de göster (${deleted})`}
            </label>
          ) : null}
          {shown?.length === 0 ? (
            <p className="text-text-2">Bu aramaya uyan restoran yok.</p>
          ) : null}
          <ul className="flex flex-col gap-3">
            {shown?.map((restaurant) => (
              <RestaurantRow
                key={restaurant.id}
                restaurant={restaurant}
                activity={activity.get(restaurant.id)}
                api={api}
                now={now()}
                onOpen={() => onOpen(restaurant.id)}
                onChanged={reload}
              />
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

function RestaurantRow({
  restaurant,
  activity,
  api,
  now,
  onOpen,
  onChanged,
}: {
  restaurant: Restaurant;
  activity: Activity | undefined;
  api: OperatorApi;
  now: Date;
  onOpen(): void;
  onChanged(): void;
}): JSX.Element {
  const [open, setOpen] = useState<'extend' | 'plan' | null>(null);
  const license = licenseText(restaurant.licenseExpiresAt, now);
  const state = statusText(restaurant.status, restaurant.deletedAt);
  const toggle = (next: 'extend' | 'plan') => setOpen((now) => (now === next ? null : next));
  const edge = state.tone === 'ok' ? EDGES[license.tone] : 'edge-quiet';

  return (
    <li className={`slip ${edge} flex flex-col gap-2 px-4 py-3`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 className="min-w-0 font-display text-label font-semibold">
          <button
            type="button"
            onClick={onOpen}
            className="-mx-1 inline-flex min-h-11 max-w-full items-center gap-1 rounded-control px-1 text-left hover:bg-bg"
          >
            <span className="truncate">{restaurant.name}</span>
            <ChevronRight aria-hidden="true" size={18} className="shrink-0 text-muted" />
          </button>
        </h3>
        <span className="rounded-chip bg-bg px-2.5 py-0.5 text-meta font-semibold text-text-2">
          {restaurant.planName}
        </span>
        {state.tone === 'ok' ? null : (
          <span
            className={`rounded-chip px-2.5 py-0.5 text-meta font-semibold ${CHIPS[state.tone]}`}
          >
            {state.text}
          </span>
        )}
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
        <dd>
          {devicesText(restaurant.devices, restaurant.maxDevices)}
          {restaurant.maxDevicesOverride !== null ? (
            <span className="text-text-2"> · özel sınır</span>
          ) : null}
        </dd>
        <dt className="text-muted">Son görülme</dt>
        <dd>{lastSeenText(restaurant.lastSeenAt, now)}</dd>
        {activity ? (
          <>
            <dt className="text-muted">30 gün</dt>
            <dd>{activityText(activity)}</dd>
          </>
        ) : null}
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
        <Button variant="ghost" onClick={onOpen}>
          Yönet
        </Button>
      </div>
      {open === 'extend' ? (
        restaurant.licenseExpiresAt === null ? (
          <p className="text-sm text-text-2">Bu restoranın lisansı süresiz; uzatmaya gerek yok.</p>
        ) : (
          <ExtendForm
            marketId={restaurant.id}
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
          marketId={restaurant.id}
          current={restaurant.plan}
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

export function ExtendForm({
  marketId,
  api,
  onDone,
}: {
  marketId: string;
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
      await api.extendLicense(marketId, days);
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
        name={`extend-${marketId}`}
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
      {error ? <Alert>{error}</Alert> : null}
      <Button variant="primary" disabled={busy} onClick={() => void extend()}>
        Süreyi uzat
      </Button>
    </div>
  );
}

export function PlanForm({
  marketId,
  current,
  api,
  onDone,
}: {
  marketId: string;
  current: PlanId;
  api: OperatorApi;
  onDone(): void;
}): JSX.Element {
  const [plan, setPlan] = useState<PlanId>(current);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setError(undefined);
    try {
      await api.setPlan(marketId, plan);
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
      {error ? <Alert>{error}</Alert> : null}
      <Button variant="primary" disabled={busy || plan === current} onClick={() => void save()}>
        Paketi kaydet
      </Button>
    </div>
  );
}
