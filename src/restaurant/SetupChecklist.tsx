import { useLiveQuery } from 'dexie-react-hooks';
import { Check, X } from 'lucide-react';
import { useState, type JSX } from 'react';
import { useData } from '@/app/appData';
import { listStaff } from '@/data/staff';
import { Button } from '@/design';

type Step = { key: string; title: string; detail: string; done: boolean; href?: string };

/** Kept per restaurant on this device: a list hidden here stays hidden after a reload. */
const HIDDEN_KEY = 'rk.setup.hidden';
const RECEIPT_KEY = 'rk.setup.receipt';

function stored(key: string, marketId: string): boolean {
  try {
    return localStorage.getItem(`${key}.${marketId}`) === '1';
  } catch {
    return false;
  }
}

function store(key: string, marketId: string): void {
  try {
    localStorage.setItem(`${key}.${marketId}`, '1');
  } catch {
    // Without storage the choice lasts until the app is closed.
  }
}

/**
 * A new owner's first evening, step by step: tables, menu, staff and PINs, the receipt, and a
 * test order. Progress is read from the data itself (nothing is stored but "hidden" and "receipt
 * looked at"), each step opens the place where it is done, and the list can be put away.
 */
export function SetupChecklist(): JSX.Element | null {
  const { db, settings } = useData();
  const marketId = settings.marketId;
  const [hidden, setHidden] = useState(() => stored(HIDDEN_KEY, marketId));
  const [receiptSeen, setReceiptSeen] = useState(() => stored(RECEIPT_KEY, marketId));
  // Open while the floor and the menu are still empty; a slim progress line after that, so the
  // tables come first. A tap on it shows the steps again.
  const [shown, setShown] = useState<boolean | null>(null);
  const counts = useLiveQuery(async () => {
    const [tables, products, staff, orders] = await Promise.all([
      db.diningTables.filter((table) => !table.archivedAt).count(),
      db.products.filter((product) => !product.deletedAt).count(),
      listStaff(db, { active: true }).then((people) => people.length),
      db.tabItems.count(),
    ]);
    return { tables, products, staff, orders };
  }, [db]);

  if (hidden || counts === undefined) {
    return null;
  }
  const steps: Step[] = [
    {
      key: 'tables',
      title: 'Masaları ekleyin',
      detail: 'Salon, bahçe: kaç masa varsa bir kerede.',
      done: counts.tables > 0,
      href: '#/settings/masalar',
    },
    {
      key: 'menu',
      title: 'Menüyü girin',
      detail: 'Kategoriler, yemekler, fiyatlar, porsiyonlar.',
      done: counts.products > 0,
      href: '#/products',
    },
    {
      key: 'staff',
      title: 'Personel ve PIN’ler',
      detail: 'Önce kendinizi sahip olarak ekleyin, sonra garsonları.',
      done: counts.staff > 0,
      href: '#/settings/personel',
    },
    {
      key: 'receipt',
      title: 'Fiş ve yazıcı',
      detail: 'İsteğe bağlı: fişin üst yazısı, kâğıt genişliği.',
      done: receiptSeen,
      href: '#/settings/fis',
    },
    {
      key: 'order',
      title: 'Deneme siparişi verin',
      detail: 'Bir masaya dokunun, bir yemek ekleyin, mutfağa gönderin.',
      done: counts.orders > 0,
    },
  ];
  const finished = steps.filter((step) => step.done).length;
  const expanded = shown ?? finished < 2;

  function hide() {
    store(HIDDEN_KEY, marketId);
    setHidden(true);
  }

  return (
    <section aria-labelledby="setup-heading" className="slip edge-open flex flex-col gap-3 p-4">
      <div className="flex items-start gap-3">
        <div className="mr-auto">
          <h2 id="setup-heading" className="text-lg font-bold tracking-[-0.01em]">
            {finished === steps.length ? 'Restoranınız hazır' : 'Restoranı kuralım'}
          </h2>
          <p className="text-sm text-text-2">{`${finished} / ${steps.length} adım tamam`}</p>
        </div>
        <Button variant="ghost" aria-expanded={expanded} onClick={() => setShown(!expanded)}>
          {expanded ? 'Daralt' : 'Adımlar'}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Kurulum listesini gizle"
          icon={<X aria-hidden="true" size={18} />}
          onClick={hide}
        />
      </div>
      <div
        aria-hidden="true"
        className="h-1.5 overflow-hidden rounded-chip bg-bg"
        title={`${finished} / ${steps.length}`}
      >
        <div
          className="h-full rounded-chip bg-accent transition-[width] duration-300"
          style={{ width: `${(finished / steps.length) * 100}%` }}
        />
      </div>
      {expanded ? (
        <ol className="flex flex-col gap-1">
          {steps.map((step, index) => {
            const content = (
              <>
                <span
                  aria-hidden="true"
                  className={`flex size-8 shrink-0 items-center justify-center rounded-chip font-display text-sm font-bold ${
                    step.done ? 'bg-success text-surface' : 'border border-line-strong text-text-2'
                  }`}
                >
                  {step.done ? <Check size={16} strokeWidth={2.5} /> : index + 1}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className={`font-semibold ${step.done ? 'text-text-2 line-through' : ''}`}>
                    {step.title}
                  </span>
                  <span className="text-sm text-text-2">{step.detail}</span>
                </span>
                <span className="sr-only">{step.done ? '(tamam)' : '(yapılacak)'}</span>
              </>
            );
            return (
              <li key={step.key}>
                {step.href && !step.done ? (
                  <a
                    href={step.href}
                    onClick={() => {
                      if (step.key === 'receipt') {
                        store(RECEIPT_KEY, marketId);
                        setReceiptSeen(true);
                      }
                    }}
                    className="flex min-h-14 items-center gap-3 rounded-control px-2 py-1.5 no-underline hover:bg-bg"
                  >
                    {content}
                  </a>
                ) : (
                  <div className="flex min-h-14 items-center gap-3 px-2 py-1.5">{content}</div>
                )}
              </li>
            );
          })}
        </ol>
      ) : null}
      {finished === steps.length ? (
        <Button variant="primary" onClick={hide}>
          Listeyi kapat
        </Button>
      ) : null}
    </section>
  );
}
