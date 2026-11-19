import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, Minus, Plus, X } from 'lucide-react';
import { useEffect, useState, type JSX } from 'react';
import { useData, useSyncStatus } from '@/app/appData';
import { AppShell } from '@/app/AppShell';
import { useSession } from '@/app/session';
import { listCategories } from '@/data/categories';
import {
  addTabItem,
  cancelBillRequest,
  changeNewItem,
  fireHeld,
  itemLabel,
  payTabItems,
  removeNewItem,
  repeatItem,
  requestBill,
  sendTab,
  setComplimentary,
  setHold,
  tabBill,
  tabTitle,
  voidItem,
  type OrderInput,
} from '@/data/restaurant';
import { normalizeForSearch } from '@/data/text';
import type { ProductRecord, TabItemRecord } from '@/data/types';
import { Button, ChoiceGroup, Dialog, TextField, ToastRegion, useToast } from '@/design';
import { formatTRY } from '@/domain/money';
import { formatLineQty } from '@/pos/format';
import { MoveDialog } from './MoveDialog';
import { OrderDialog } from './OrderDialog';
import { PayDialog } from './PayDialog';

const ALL = '';

const STATUS_LABELS: Record<TabItemRecord['status'], string> = {
  new: 'Gönderilmedi',
  held: 'Sırada',
  sent: 'Hazırlanıyor',
  ready: 'Hazır',
  void: 'İptal',
};

/**
 * One tab: the menu on one side, the order on the other. Lines are taken (a dish with portions
 * or choices asks for them), then sent to the kitchen and the bar in one go, or kept back for
 * the next course and fired later. A sent line can be repeated, made a treat or voided with a
 * reason. Asking for the bill locks the tab until it is paid or unlocked.
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
  const [ordering, setOrdering] = useState<ProductRecord | null>(null);
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
  const held = (items ?? []).filter((item) => item.status === 'held');
  const paid = (items ?? []).filter((item) => item.paidSaleId);
  const billRequested = tab?.record.billRequestedAt !== undefined;

  async function order(product: ProductRecord) {
    if (billRequested) {
      toast.show('Hesap istendi. Sipariş eklemek için önce kilidi açın.');
      return;
    }
    // A dish that asks for a portion or a choice opens its own window.
    if ((product.portions?.length ?? 0) > 0 || (product.optionGroups?.length ?? 0) > 0) {
      setOrdering(product);
      return;
    }
    try {
      // A second tap on the same dish adds one more to the line being taken.
      // Read from the database, not the screen: two quick taps must not make two lines.
      const lines = await db.tabItems.where('tabId').equals(tabId).toArray();
      const same = lines.find(
        (item) =>
          item.status === 'new' &&
          item.productId === product.id &&
          !item.note &&
          !item.portion &&
          !item.options &&
          !item.hold,
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
    const holding = fresh.filter((item) => item.hold).length;
    const count = await sendTab(db, tabId, new Date());
    toast.show(
      holding > 0
        ? `${count - holding} kalem gönderildi, ${holding} kalem sırada.`
        : `${count} kalem gönderildi.`,
    );
    void runner.run();
  }

  async function addOrdered(product: ProductRecord, input: OrderInput) {
    try {
      await addTabItem(db, tabId, product, input, waiter, new Date());
      setOrdering(null);
    } catch {
      toast.show('Ürün eklenemedi.');
    }
  }

  // A table opened and left with nothing ordered is not taken: its tab closes.
  async function leave() {
    // Read from the database: a quick tap can come before the screen has loaded the tab.
    const [lines, record] = await Promise.all([
      db.tabItems.where('tabId').equals(tabId).count(),
      db.tabs.get(tabId),
    ]);
    if (lines === 0 && record?.status === 'open') {
      await payTabItems(db, { tabId, itemIds: [], payments: [], ...waiter }, new Date());
    }
    onClose();
  }

  async function fire() {
    const count = await fireHeld(db, tabId, new Date());
    toast.show(`Sıradaki ${count} kalem gönderildi.`);
    void runner.run();
  }

  async function toggleBillRequest() {
    if (billRequested) {
      await cancelBillRequest(db, tabId, new Date());
      toast.show('Kilit açıldı; sipariş eklenebilir.');
    } else {
      await requestBill(db, tabId, new Date());
      toast.show('Hesap istendi.');
    }
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
        immersive
      >
        <div className="flex flex-wrap items-center gap-3">
          <Button icon={<ArrowLeft aria-hidden="true" size={18} />} onClick={() => void leave()}>
            Masalar
          </Button>
          <h1 className="mr-auto text-xl font-semibold">{tab?.title ?? ''}</h1>
          {held.length > 0 ? (
            <Button variant="primary" onClick={() => void fire()}>
              {`Sıradakileri gönder (${held.length})`}
            </Button>
          ) : null}
          <Button onClick={() => void toggleBillRequest()}>
            {billRequested ? 'Kilidi aç' : 'Hesap iste'}
          </Button>
          <Button onClick={() => setDialog('move')}>Taşı / birleştir</Button>
        </div>
        {billRequested ? (
          <p
            role="status"
            className="rounded-control border border-accent bg-accent/10 p-3 font-medium"
          >
            Hesap istendi. Yeni sipariş için “Kilidi aç”a basın.
          </p>
        ) : null}
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
                    <span className="font-display text-sm font-medium text-text-2">
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
                        <p className="font-medium break-words">{itemLabel(item)}</p>
                        <p className="text-sm text-text-2">
                          {`${formatLineQty(item.qtyMilli, item.unit)} · ${item.status === 'new' && item.hold ? 'Sonra gönderilecek' : STATUS_LABELS[item.status]}${item.complimentary ? ' · İkram' : ''}`}
                        </p>
                        {item.options ? (
                          <p className="text-sm text-text-2">{item.options.join(' · ')}</p>
                        ) : null}
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
                        <div className="flex flex-wrap gap-2">
                          <Button variant="ghost" onClick={() => setNoteFor(item.id)}>
                            Not ekle
                          </Button>
                          <Button
                            variant="ghost"
                            aria-pressed={item.hold === true}
                            onClick={() => void setHold(db, item.id, !item.hold, new Date())}
                          >
                            {item.hold ? 'Şimdi gönder' : 'Sonra gönder'}
                          </Button>
                        </div>
                      )
                    ) : item.status !== 'void' ? (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="ghost"
                          disabled={billRequested}
                          onClick={() =>
                            void repeatItem(db, item.id, waiter, new Date()).catch(() =>
                              toast.show('Tekrarlanamadı.'),
                            )
                          }
                        >
                          Tekrarla
                        </Button>
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
        <div className="sticky bottom-0 z-20 -mx-4 -mb-4 flex items-center gap-2 border-t border-line-strong bg-surface px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:gap-3 md:-mx-6 md:-mb-5 md:px-6 xl:-mx-8 xl:px-8">
          <span className="hidden font-semibold sm:inline">Kalan</span>
          <span
            aria-label="Kalan tutar"
            className="mr-auto font-display text-xl font-bold tracking-[-0.02em] sm:text-2xl"
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
      {ordering ? (
        <OrderDialog
          product={ordering}
          onClose={() => setOrdering(null)}
          onOrder={(input) => addOrdered(ordering, input)}
        />
      ) : null}
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
