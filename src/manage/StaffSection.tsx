import { useLiveQuery } from 'dexie-react-hooks';
import type { JSX } from 'react';
import { useData } from '@/app/appData';
import { useMarketSettings } from '@/app/marketSettings';
import { businessDate } from '@/domain/businessDate';
import { formatTRY } from '@/domain/money';
import { periodOf } from '@/reports/period';
import { loadStaffStats, type StaffStat } from './staffStats';

const byName = new Intl.Collator('tr');

/** Yönetim's staff section: each person's sales and service, today and this month. */
export function StaffSection(): JSX.Element {
  const { db } = useData();
  const { cutoffMinutes } = useMarketSettings();
  const people = useLiveQuery(async () => {
    const today = businessDate(new Date(), { cutoffMinutes });
    const [staff, day, month] = await Promise.all([
      db.staff.toArray(),
      loadStaffStats(db, { ...periodOf('today', today), cutoffMinutes }),
      loadStaffStats(db, { ...periodOf('month', today), cutoffMinutes }),
    ]);
    const of = (stats: StaffStat[], id: string) => stats.find((stat) => stat.staffId === id);
    return (
      staff
        // Someone who left stays while they still have work in the month.
        .filter((person) => !person.archivedAt || of(month, person.id) !== undefined)
        .sort((a, b) => byName.compare(a.name, b.name))
        .map((person) => ({
          id: person.id,
          name: person.name,
          archived: person.archivedAt !== undefined,
          day: of(day, person.id),
          month: of(month, person.id),
        }))
    );
  }, [db, cutoffMinutes]);

  return (
    <>
      <h2 className="text-lg font-semibold">Personel</h2>
      {people === undefined ? null : people.length === 0 ? (
        <p className="text-text-2">
          Henüz personel yok. Ayarlar’daki Personel bölümünden ekleyebilirsiniz.
        </p>
      ) : (
        <>
          <ul className="grid gap-3 md:grid-cols-2">
            {people.map((person) => (
              <li key={person.id} className="min-w-0">
                <section
                  role="group"
                  aria-label={person.name}
                  className="flex flex-col gap-3 rounded-control border border-line p-3"
                >
                  <h3 className="flex items-center gap-2 font-semibold">
                    <span className="min-w-0 break-words">{person.name}</span>
                    {person.archived ? (
                      <span className="text-sm font-normal text-muted">Pasif</span>
                    ) : null}
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    <Period title="Bugün" stat={person.day} />
                    <Period title="Bu ay" stat={person.month} />
                  </div>
                </section>
              </li>
            ))}
          </ul>
          <p className="text-sm text-text-2">
            Satış: iptal edilmeyen hesapların toplamı. İptal: geri alınan ürün ve iptal edilen
            satış. Adı kaydedilmemiş eski iptaller sayılmaz.
          </p>
        </>
      )}
    </>
  );
}

function Period({ title, stat }: { title: string; stat: StaffStat | undefined }): JSX.Element {
  const rows: [string, string][] = [
    ['Sipariş', String(stat?.orders ?? 0)],
    ['Açtığı hesap', String(stat?.tabsOpened ?? 0)],
    ['Kapattığı hesap', String(stat?.billsClosed ?? 0)],
    ['Satış', formatTRY(stat?.salesTotal ?? 0)],
    ['İptal', String((stat?.voidedLines ?? 0) + (stat?.voidedSales ?? 0))],
  ];
  return (
    <section role="group" aria-label={title} className="min-w-0">
      <h4 className="mb-1 text-sm font-medium text-text-2">{title}</h4>
      <dl className="flex flex-col gap-1 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex flex-wrap items-baseline justify-between gap-x-2">
            <dt className="text-text-2">{label}</dt>
            <dd className="font-medium tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
