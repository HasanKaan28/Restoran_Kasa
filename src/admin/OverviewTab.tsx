import { ChevronRight } from 'lucide-react';
import { useState, type JSX } from 'react';
import { Button } from '@/design';
import type { OperatorApi, Overview } from './api';
import { countText, dayText, licenseText } from './model';
import { failed, TONES, useLoad } from './load';
import { Alert, Loading } from './ui';

const EDGES = { ok: 'edge-ready', warning: 'edge-bill', danger: 'edge-late' } as const;

/** The quick extensions offered beside a licence that is ending. */
const QUICK = [
  { days: 30, label: '+1 ay' },
  { days: 365, label: '+1 yıl' },
] as const;

/**
 * The seller's first look: how many restaurants run, wait or have lapsed, the codes and the
 * registers, and the licences ending this week with a one-tap extension.
 */
export function OverviewTab({
  api,
  onOpen,
  now = () => new Date(),
}: {
  api: OperatorApi;
  onOpen(marketId: string): void;
  now?: () => Date;
}): JSX.Element {
  const { data, error, reload } = useLoad(() => api.overview(), 'overview');

  return (
    <section aria-labelledby="overview" className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <h2 id="overview" className="text-title font-semibold">
          Özet
        </h2>
        <Button variant="ghost" className="ml-auto" onClick={reload}>
          Yenile
        </Button>
      </div>
      {error ? <Alert>{error}</Alert> : null}
      {data === undefined && !error ? <Loading /> : null}
      {data ? (
        <>
          <Figures overview={data} />
          <Expiring overview={data} api={api} now={now()} onOpen={onOpen} onChanged={reload} />
        </>
      ) : null}
    </section>
  );
}

function Figures({ overview }: { overview: Overview }): JSX.Element {
  const { restaurants, codes, devices } = overview;
  const groups: { title: string; items: { label: string; value: number; tone?: string }[] }[] = [
    {
      title: 'Restoranlar',
      items: [
        { label: 'Etkin', value: restaurants.active },
        {
          label: '7 günde bitiyor',
          value: restaurants.expiring,
          ...(restaurants.expiring > 0 ? { tone: 'text-warning' } : {}),
        },
        {
          label: 'Süresi dolmuş',
          value: restaurants.expired,
          ...(restaurants.expired > 0 ? { tone: 'text-danger' } : {}),
        },
        { label: 'Askıda', value: restaurants.suspended },
      ],
    },
    {
      title: 'Kodlar',
      items: [
        { label: 'Üretilen', value: codes.issued },
        { label: 'Kullanılan', value: codes.used },
        { label: 'Bekleyen', value: codes.unused },
        { label: 'İptal', value: codes.revoked },
      ],
    },
    {
      title: 'Cihazlar',
      items: [
        { label: 'Bağlı', value: devices.total },
        { label: 'Bugün görülen', value: devices.seenToday },
      ],
    },
  ];
  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
        <section key={group.title} aria-label={group.title} className="flex flex-col gap-2">
          <h3 className="text-meta font-semibold tracking-wide text-muted uppercase">
            {group.title}
          </h3>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {group.items.map((item) => (
              <div
                key={item.label}
                className="flex flex-col-reverse gap-1 rounded-plate border border-line bg-surface px-4 py-3"
              >
                <dt className="text-sm text-text-2">{item.label}</dt>
                <dd
                  className={`font-display text-figure font-semibold tabular-nums ${item.tone ?? ''}`}
                >
                  {countText(item.value)}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
      {restaurants.deleted > 0 ? (
        <p className="text-meta text-muted">
          {`Silinmiş ${countText(restaurants.deleted)} restoran sayılara katılmadı.`}
        </p>
      ) : null}
    </div>
  );
}

function Expiring({
  overview,
  api,
  now,
  onOpen,
  onChanged,
}: {
  overview: Overview;
  api: OperatorApi;
  now: Date;
  onOpen(marketId: string): void;
  onChanged(): void;
}): JSX.Element {
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<string>();

  async function extend(id: string, name: string, days: number) {
    setBusy(id);
    setError(undefined);
    setDone(undefined);
    try {
      const { licenseExpiresAt } = await api.extendLicense(id, days);
      setDone(`${name}: yeni bitiş ${dayText(licenseExpiresAt)}.`);
      onChanged();
    } catch (reason) {
      setError(failed(reason));
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <section aria-labelledby="expiring" className="flex flex-col gap-3">
      <h3 id="expiring" className="font-display text-label font-semibold">
        Süresi yaklaşanlar
      </h3>
      {done ? (
        <p role="status" className="text-sm font-medium text-success">
          {done}
        </p>
      ) : null}
      {error ? <Alert>{error}</Alert> : null}
      {overview.expiring.length === 0 ? (
        <p className="text-text-2">Bu hafta biten lisans yok.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {overview.expiring.map((item) => {
            const license = licenseText(item.licenseExpiresAt, now);
            return (
              <li
                key={item.id}
                className={`slip ${EDGES[license.tone]} flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center`}
              >
                <button
                  type="button"
                  onClick={() => onOpen(item.id)}
                  className="-mx-1 flex min-h-touch min-w-0 flex-1 items-center gap-2 rounded-control px-1 text-left hover:bg-bg"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-semibold">{item.name}</span>
                    <span className={`text-sm font-medium ${TONES[license.tone]}`}>
                      {license.text}
                      <span className="font-normal text-text-2">
                        {` · ${dayText(item.licenseExpiresAt)} · ${item.planName}`}
                      </span>
                    </span>
                  </span>
                  <ChevronRight
                    aria-hidden="true"
                    size={18}
                    className="ml-auto shrink-0 text-muted"
                  />
                </button>
                <div className="grid grid-cols-2 gap-2 sm:flex">
                  {QUICK.map((quick) => (
                    <Button
                      key={quick.days}
                      disabled={busy === item.id}
                      aria-label={`${item.name}: ${quick.label}`}
                      onClick={() => void extend(item.id, item.name, quick.days)}
                    >
                      {quick.label}
                    </Button>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
