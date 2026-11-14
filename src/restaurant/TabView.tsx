import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, Minus, Plus, X } from 'lucide-react';
import { useEffect, useState, type JSX } from 'react';
import { useData, useSyncStatus } from '@/app/appData';
import { AppShell } from '@/app/AppShell';
import { useSession } from '@/app/session';
import { listCategories } from '@/data/categories';
import {
  addTabItem,
  changeNewItem,
  removeNewItem,
  sendTab,
  setComplimentary,
  tabBill,
  tabTitle,
  voidItem,
} from '@/data/restaurant';
import { normalizeForSearch } from '@/data/text';
import type { ProductRecord, TabItemRecord } from '@/data/types';
import { Button, ChoiceGroup, Dialog, TextField, ToastRegion, useToast } from '@/design';
import { formatTRY } from '@/domain/money';
import { formatLineQty } from '@/pos/format';
import { MoveDialog } from './MoveDialog';
import { PayDialog } from './PayDialog';

const ALL = '';

const STATUS_LABELS: Record<TabItemRecord['status'], string> = {
  new: 'Gönderilmedi',
  sent: 'Hazırlanıyor',
  ready: 'Hazır',
  void: 'İptal',
};

/**
 * One tab: the menu on one side, the order on the other. Lines are taken, then sent to the
 * kitchen and the bar in one go; a sent line can be made a treat or voided with a reason.
 */
export function TabView({ tabId, onClose }: { tabId: string; onClose(): void }): JSX.Element {
  const { db, settings, runner } = useData();
  const status = useSyncStatus(runner);
  const session = useSession();
  const toast = useToast();
  const [category, setCategory] = useState(ALL);
  const [term, setTerm] = useState('');
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [voiding, setVoiding] = useState<TabItemRecord | null>(null);
  const [dialog, setDialog] = useState<'pay' | 'move' | null>(null);
  const waiter = { deviceCode: settings.deviceCode, staffId: session.staff?.id };

  const tab = useLiveQuery(async () => {
    const record = await db.tabs.get(tabId);
    return record ? { record, title: await tabTitle(db, record) } : null;
  }, [db, tabId]);
  const items = useLiveQuery(
    async () =>
      (await db.tabItems.where('tabId').equals(tabId).toArray()).sort(
        (a, b) => a.orderedAt.localeCompare(b.orderedAt) || a.id.localeCompare(b.id),
      ),
    [db, tabId],
  );
  const bill = useLiveQuery(() => tabBill(db, tabId), [db, tabId]);
  const categories = useLiveQuery(() => listCategories(db), [db]);
  const needle = normalizeForSearch(term);
  const products = useLiveQuery(
    async () =>
      (
        await db.products
          .filter(
            (product) =>
              !product.deletedAt &&
              (category === ALL || product.categoryId === category) &&
              (needle === '' || normalizeForSearch(product.name).includes(needle)),
          )
          .toArray()
      ).sort((a, b) => a.name.localeCompare(b.name, 'tr')),
    [db, category, needle],
  );

  const gone = tab === null || (tab !== undefined && tab.record.status !== 'open');
  useEffect(() => {
    // Paid, merged or gone on another device: back to the floor.
    if (gone) {
      onClose();
    }
  }, [gone, onClose]);

  const fresh = (items ?? []).filter((item) => item.status === 'new');
  const paid = (items ?? []).filter((item) => item.paidSaleId);

  async function order(product: ProductRecord) {
    try {
      // A second tap on the same dish adds one more to the line being taken.
      // Read from the database, not the screen: two quick taps must not make two lines.
      const lines = await db.tabItems.where('tabId').equals(tabId).toArray();
      const same = lines.find(
        (item) => item.status === 'new' && item.productId === product.id && !item.note,
      );
      if (same) {
        await changeNewItem(db, same.id, { qtyMilli: same.qtyMilli + 1000 }, new Date());
      } else {
        await addTabItem(db, tabId, product, { qtyMilli: 1000 }, waiter, new Date());
      }
    } catch {
      toast.show('Ürün eklenemedi.');
    }
  }

  async function send() {
    const count = await sendTab(db, tabId, new Date());
    toast.show(`${count} kalem gönderildi.`);
    void runner.run();
  }

  async function step(item: TabItemRecord, delta: number) {
    const next = item.qtyMilli + delta;
    if (next <= 0) {
      await removeNewItem(db, item.id, new Date());
    } else {
      await changeNewItem(db, item.id, { qtyMilli: next }, new Date());
    }
  }

  return (
    <>
      <AppShell
        marketName={settings.marketName}
        deviceName={settings.deviceName}
        syncState={status.state}
        pendingCount={status.pendingCount}
        syncError={status.error}
        activeNav="tables"
      >
        <div className="flex flex-wrap items-center gap-3">
          <Button icon={<ArrowLeft aria-hidden="true" size={18} />} onClick={onClose}>
            Masalar
          </Button>
          <h1 className="mr-auto text-xl font-semibold">{tab?.title ?? ''}</h1>
          <Button onClick={() => setDialog('move')}>Taşı / birleştir</Button>
        </div>
        <div className="grid gap-4 lg:grid-cols-[1fr_24rem]">
          <section aria-label="Menü" className="flex min-w-0 flex-col gap-3">
            <TextField
              label="Menüde ara"
              autoComplete="off"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
            />
            {categories && categories.length > 0 ? (
              <ChoiceGroup<string>
                legend="Kategori"
                name="menuCategory"
                wrap
                options={[
                  { value: ALL, label: 'Tümü' },
                  ...categories.map((item) => ({ value: item.id, label: item.name })),
                ]}
                value={category}
                onChange={setCategory}
              />
            ) : null}
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2">
              {(products ?? []).map((product) => (
                <li key={product.id}>
                  <button
                    type="button"
                    onClick={() => void order(product)}
                    className="flex min-h-20 w-full flex-col justify-between rounded-control border border-line bg-surface p-2.5 text-left hover:bg-bg"
                  >
                    <span className="font-medium break-words">{product.name}</span>
                    <span className="font-mono text-sm text-text-2">
                      {formatTRY(product.sellPrice)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section
            aria-label="Adisyon"
            className="flex flex-col gap-3 rounded-control border border-line bg-surface p-3"
          >
            <ul className="flex flex-col divide-y divide-line">
              {(items ?? [])
                .filter((item) => !item.paidSaleId)
                .map((item) => (
                  <li key={item.id} className="flex flex-col gap-1 py-2">
                    <div className="flex items-start gap-2">
                      <div
                        className={`min-w-0 flex-1 ${item.status === 'void' ? 'line-through opacity-60' : ''}`}
                      >
                        <p className="font-medium break-words">{item.name}</p>
                        <p className="font-mono text-sm text-text-2">
                          {`${formatLineQty(item.qtyMilli, item.unit)} · ${STATUS_LABELS[item.status]}${item.complimentary ? ' · İkram' : ''}`}
                        </p>
                        {item.note ? (
                          <p className="text-sm text-text-2">{`Not: ${item.note}`}</p>
                        ) : null}
                        {item.voidReason && item.status === 'void' ? (
                          <p className="text-sm text-text-2">{item.voidReason}</p>
                        ) : null}
                      </div>
                      {item.status === 'new' ? (
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Bir azalt: ${item.name}`}
                            icon={<Minus aria-hidden="true" size={16} />}
                            onClick={() => void step(item, -1000)}
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Bir artır: ${item.name}`}
                            icon={<Plus aria-hidden="true" size={16} />}
                            onClick={() => void step(item, 1000)}
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Çıkar: ${item.name}`}
                            icon={<X aria-hidden="true" size={16} />}
                            onClick={() => void removeNewItem(db, item.id, new Date())}
                          />
                        </div>
                      ) : null}
                    </div>
                    {item.status === 'new' ? (
                      noteFor === item.id ? (
                        <TextField
                          label={`Not: ${item.name}`}
                          autoFocus
                          defaultValue={item.note ?? ''}
                          onBlur={(event) => {
                            void changeNewItem(
                              db,
                              item.id,
                              { note: event.target.value },
                              new Date(),
                            );
                            setNoteFor(null);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.currentTarget.blur();
                            }
                          }}
                        />
                      ) : (
                        <div>
                          <Button variant="ghost" onClick={() => setNoteFor(item.id)}>
                            Not ekle
                          </Button>
                        </div>
                      )
                    ) : item.status !== 'void' ? (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="ghost"
                          disabled={!session.can('discount')}
                          onClick={() =>
                            void setComplimentary(db, item.id, !item.complimentary, new Date())
                          }
                        >
                          {item.complimentary ? 'İkramı kaldır' : 'İkram'}
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={!session.can('voidSale')}
                          onClick={() => setVoiding(item)}
                        >
                          İptal
                        </Button>
                      </div>
                    ) : null}
                  </li>
                ))}
            </ul>
            {items && items.length === 0 ? (
              <p className="text-text-2">Menüden ürün seçin.</p>
            ) : null}
            {paid.length > 0 ? (
              <p className="text-sm text-text-2">{`${paid.length} kalem ödendi.`}</p>
            ) : null}
          </section>
        </div>
        {/* Always in reach, on a phone too: the menu can be long, the total and sending are not. */}
        <div className="sticky bottom-0 z-20 -mx-5 -mb-4 flex items-center gap-2 border-t border-line-strong bg-surface px-5 py-3 sm:gap-3">
          <span className="hidden font-semibold sm:inline">Kalan</span>
          <span
            aria-label="Kalan tutar"
            className="mr-auto font-mono text-xl font-bold sm:text-2xl"
          >
            {formatTRY(bill?.total ?? 0)}
          </span>
          <Button
            variant="primary"
            size="lg"
            disabled={fresh.length === 0}
            onClick={() => void send()}
          >
            {`Gönder (${fresh.length})`}
          </Button>
          <Button size="lg" disabled={!session.can('sell')} onClick={() => setDialog('pay')}>
            Hesap
          </Button>
        </div>
      </AppShell>
      {voiding ? (
        <VoidDialog
          item={voiding}
          onClose={() => setVoiding(null)}
          onVoid={async (reason) => {
            await voidItem(db, voiding.id, reason, new Date());
            setVoiding(null);
            toast.show(`${voiding.name} iptal edildi.`);
          }}
        />
      ) : null}
      {dialog === 'pay' ? (
        <PayDialog
          tabId={tabId}
          onClose={() => setDialog(null)}
          onPaid={(message, closed) => {
            setDialog(null);
            toast.show(message);
            void runner.run();
            if (closed) {
              onClose();
            }
          }}
        />
      ) : null}
      {dialog === 'move' ? (
        <MoveDialog
          tabId={tabId}
          onClose={() => setDialog(null)}
          onMoved={(message, closed) => {
            setDialog(null);
            toast.show(message);
            void runner.run();
            if (closed) {
              onClose();
            }
          }}
        />
      ) : null}
      <ToastRegion message={toast.message} />
    </>
  );
}

function VoidDialog({
  item,
  onClose,
  onVoid,
}: {
  item: TabItemRecord;
  onClose(): void;
  onVoid(reason: string): Promise<void>;
}): JSX.Element {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()} title={`İptal: ${item.name}`}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (reason.trim() === '') {
            setError('İptalin nedenini yazın.');
            return;
          }
          void onVoid(reason);
        }}
      >
        <TextField
          label="Neden"
          autoFocus
          value={reason}
          error={error}
          onChange={(event) => setReason(event.target.value)}
        />
        <Button type="submit" variant="danger">
          İptal et
        </Button>
      </form>
    </Dialog>
  );
}
