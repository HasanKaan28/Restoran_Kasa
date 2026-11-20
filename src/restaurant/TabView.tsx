import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, ChevronUp, Ellipsis } from 'lucide-react';
import { useEffect, useState, type JSX } from 'react';
import { useData, useSyncStatus } from '@/app/appData';
import { AppShell } from '@/app/AppShell';
import { useLicense } from '@/app/license';
import { useSession } from '@/app/session';
import { useApproval } from '@/app/useApproval';
import { listCategories } from '@/data/categories';
import {
  addOneMore,
  addTabItem,
  cancelBillRequest,
  changeNewItem,
  fireHeld,
  itemLabel,
  markServed,
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
import type { ProductRecord, TabItemRecord } from '@/data/types';
import { useHoldUpdates } from '@/updates/workGuard';
import {
  Button,
  Dialog,
  TextField,
  ToastRegion,
  useBottomBar,
  useMediaQuery,
  useToast,
} from '@/design';
import { formatTRY } from '@/domain/money';
import { MenuBrowser } from './MenuBrowser';
import { MoveDialog } from './MoveDialog';
import { OrderDialog } from './OrderDialog';
import { OrderLines, type OrderLineActions } from './OrderLines';
import { PayDialog } from './PayDialog';

const PHONE = '(max-width: 767px)';
const NO_SALE = 'Lisans süresi doldu; yeni sipariş alınamaz.';

/**
 * One tab: the menu, and the order as the adisyon lists it. Lines are taken (a dish with portions
 * or choices asks for them), then sent to the kitchen and the bar in one go, or kept back for the
 * next course and fired later. A sent line can be repeated, made a treat or voided with a reason.
 * Asking for the bill locks the tab until it is paid or unlocked.
 *
 * From 768 px the menu and the order sit side by side. On a phone the menu fills the screen and
 * a bar under the thumb holds the total, sending and the bill; the order opens from it as a sheet.
 */
export function TabView({ tabId, onClose }: { tabId: string; onClose(): void }): JSX.Element {
  const { db, settings, runner } = useData();
  const status = useSyncStatus(runner);
  const session = useSession();
  const toast = useToast();
  const phone = useMediaQuery(PHONE);
  const [sheet, setSheet] = useState<'order' | 'more' | null>(null);
  const [lineFor, setLineFor] = useState<TabItemRecord | null>(null);
  const [voiding, setVoiding] = useState<TabItemRecord | null>(null);
  const [dialog, setDialog] = useState<'pay' | 'move' | null>(null);
  const [ordering, setOrdering] = useState<ProductRecord | null>(null);
  const waiter = { deviceCode: settings.deviceCode, staffId: session.staff?.id };
  // Once the licence's grace is over nothing more is sold (DESIGN §8.6): no new order is taken,
  // and what the table has had can still be paid.
  const closedForSale = useLicense().kind === 'readOnly';
  // A treat or a void by someone not allowed to make one waits for a permitted person's PIN.
  const approval = useApproval();

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
  const products = useLiveQuery(
    async () =>
      (await db.products.filter((product) => !product.deletedAt).toArray()).sort((a, b) =>
        a.name.localeCompare(b.name, 'tr'),
      ),
    [db],
  );

  const gone = tab === null || (tab !== undefined && tab.record.status !== 'open');
  useEffect(() => {
    // Paid, merged or gone on another device: back to the floor.
    if (gone) {
      onClose();
    }
  }, [gone, onClose]);

  const fresh = (items ?? []).filter((item) => item.status === 'new');
  // An order being taken: a new release reloads the web app only once it is sent.
  useHoldUpdates(fresh.length > 0);
  const held = (items ?? []).filter((item) => item.status === 'held');
  const paid = (items ?? []).filter((item) => item.paidSaleId);
  const shown = (items ?? []).filter((item) => !item.paidSaleId);
  const billRequested = tab?.record.billRequestedAt !== undefined;
  const toServe = shown.filter((item) => item.status === 'ready' && !item.servedAt);
  const amounts = new Map((bill?.lines ?? []).map((line) => [line.item.id, line.amount]));
  const taken = new Map<string, number>();
  for (const item of fresh) {
    taken.set(item.productId, (taken.get(item.productId) ?? 0) + item.qtyMilli / 1000);
  }

  async function order(product: ProductRecord) {
    if (closedForSale) {
      toast.show(NO_SALE);
      return;
    }
    if (billRequested) {
      toast.show('Hesap istendi. Sipariş eklemek için önce “Siparişe aç”a basın.');
      return;
    }
    // A dish that asks for a portion or a choice opens its own window.
    if ((product.portions?.length ?? 0) > 0 || (product.optionGroups?.length ?? 0) > 0) {
      setOrdering(product);
      return;
    }
    try {
      // A second tap on the same dish adds one more to the line being taken, read and written
      // in one go: quick taps must neither make two lines nor lose one.
      const line = await addOneMore(db, tabId, product, waiter, new Date());
      confirmAdded(product.name, line.qtyMilli / 1000);
    } catch {
      toast.show('Ürün eklenemedi.');
    }
  }

  /** On a phone the order is out of sight: a short toast and a tick of the motor confirm a tap. */
  function confirmAdded(name: string, count: number) {
    if (phone) {
      toast.show(`${name} · ${count}`);
      navigator.vibrate?.(10);
    }
  }

  async function send() {
    const holding = fresh.filter((item) => item.hold).length;
    const count = await sendTab(db, tabId, new Date());
    toast.show(
      holding > 0
        ? `${count - holding} kalem gönderildi, ${holding} kalem bekliyor.`
        : `${count} kalem gönderildi.`,
    );
    navigator.vibrate?.(10);
    void runner.run();
  }

  async function addOrdered(product: ProductRecord, input: OrderInput) {
    try {
      await addTabItem(db, tabId, product, input, waiter, new Date());
      setOrdering(null);
      confirmAdded(product.name, input.qtyMilli / 1000);
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
    toast.show(`Bekleyen ${count} kalem gönderildi.`);
    void runner.run();
  }

  async function serve(ids: readonly string[], served: boolean) {
    const count = await markServed(db, ids, served, new Date());
    if (served && count > 0) {
      toast.show(`${count} kalem servis edildi.`, {
        label: 'Geri al',
        onAction: () => void markServed(db, ids, false, new Date()),
      });
    }
    void runner.run();
  }

  async function toggleBillRequest() {
    setSheet(null);
    if (billRequested) {
      await cancelBillRequest(db, tabId, new Date());
      toast.show('Siparişe açıldı.');
    } else {
      await requestBill(db, tabId, new Date());
      toast.show('Hesap istendi.');
    }
    void runner.run();
  }

  const lineActions: OrderLineActions = {
    step: (item, delta) => {
      const next = item.qtyMilli + delta;
      void (next <= 0
        ? removeNewItem(db, item.id, new Date())
        : changeNewItem(db, item.id, { qtyMilli: next }, new Date()));
    },
    remove: (item) => void removeNewItem(db, item.id, new Date()),
    note: (item, note) => void changeNewItem(db, item.id, { note }, new Date()),
    hold: (item, hold) => void setHold(db, item.id, hold, new Date()),
    open: (item) => setLineFor(item),
  };

  const sendLabel = `Mutfağa gönder (${fresh.length})`;
  const actions = (
    <OrderActions
      total={bill?.total ?? 0}
      fresh={fresh.length}
      held={held.length}
      ready={toServe.length}
      onServe={() =>
        void serve(
          toServe.map((item) => item.id),
          true,
        )
      }
      canPay={session.can('sell')}
      sendLabel={sendLabel}
      onSend={() => void send()}
      onFire={() => void fire()}
      onPay={() => setDialog('pay')}
    />
  );
  const orderContent = (
    <>
      <OrderLines items={shown} amounts={amounts} actions={lineActions} />
      {items && items.length === 0 ? (
        <p className="py-2 text-text-2">Menüden ürün seçin; seçtikleriniz burada toplanır.</p>
      ) : null}
      {paid.length > 0 ? (
        <p className="text-sm text-text-2">{`${paid.length} kalem ödendi.`}</p>
      ) : null}
    </>
  );

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
        <div className="flex items-center gap-2">
          <Button
            variant={phone ? 'ghost' : 'secondary'}
            className={phone ? '-ml-2 size-12 min-h-0 px-0' : ''}
            icon={<ArrowLeft aria-hidden="true" size={phone ? 22 : 18} />}
            onClick={() => void leave()}
          >
            <span className={phone ? 'sr-only' : ''}>Masalar</span>
          </Button>
          <h1 className="mr-auto min-w-0 truncate text-title font-bold tracking-[-0.02em]">
            {tab?.title ?? ''}
          </h1>
          {phone ? (
            <Button
              variant="ghost"
              size="icon"
              className="size-12"
              aria-label="Masa işlemleri"
              icon={<Ellipsis aria-hidden="true" size={22} />}
              onClick={() => setSheet('more')}
            />
          ) : (
            <>
              <Button onClick={() => void toggleBillRequest()}>
                {billRequested ? 'Siparişe aç' : 'Hesap iste'}
              </Button>
              <Button onClick={() => setDialog('move')}>Taşı / birleştir</Button>
            </>
          )}
        </div>
        {billRequested ? (
          <div
            role="status"
            className="slip edge-bill flex flex-wrap items-center gap-3 bg-warning-bg p-3"
          >
            <p className="flex-1 font-medium">
              Hesap istendi: adisyon kilitli. Yeni sipariş için “Siparişe aç”a basın.
            </p>
            {phone ? (
              <Button variant="secondary" onClick={() => void toggleBillRequest()}>
                Siparişe aç
              </Button>
            ) : null}
          </div>
        ) : null}

        <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_24rem]">
          <MenuBrowser
            // Both at once: dishes laid out before their categories would jump into sections.
            products={categories ? (products ?? []) : []}
            categories={categories ?? []}
            taken={taken}
            onPick={(product) => void order(product)}
          />
          {phone ? null : (
            <section
              aria-label="Adisyon"
              className="slip perforated edge-open sticky top-4 flex max-h-[calc(100dvh-2rem)] flex-col self-start"
            >
              <h2 className="px-4 pt-4 text-lg font-bold tracking-[-0.01em]">Adisyon</h2>
              <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-2">{orderContent}</div>
              <div className="border-t border-line p-4">{actions}</div>
            </section>
          )}
        </div>
        {phone ? (
          <PhoneOrderBar
            total={bill?.total ?? 0}
            lines={shown.length}
            fresh={fresh.length}
            canPay={session.can('sell')}
            sendLabel={sendLabel}
            onOpen={() => setSheet('order')}
            onSend={() => void send()}
            onPay={() => setDialog('pay')}
          />
        ) : null}
      </AppShell>

      {sheet === 'order' ? (
        <Dialog
          open
          onOpenChange={(next) => !next && setSheet(null)}
          title="Adisyon"
          footer={actions}
        >
          <section aria-label="Adisyon">{orderContent}</section>
        </Dialog>
      ) : null}
      {sheet === 'more' ? (
        <Dialog open onOpenChange={(next) => !next && setSheet(null)} title={tab?.title ?? ''}>
          <div className="flex flex-col gap-2">
            <Button onClick={() => void toggleBillRequest()}>
              {billRequested ? 'Siparişe aç' : 'Hesap iste'}
            </Button>
            <Button
              onClick={() => {
                setSheet(null);
                setDialog('move');
              }}
            >
              Taşı / birleştir
            </Button>
          </div>
        </Dialog>
      ) : null}
      {lineFor ? (
        <LineSheet
          item={lineFor}
          amount={amounts.get(lineFor.id)}
          canRepeat={!billRequested}
          onClose={() => setLineFor(null)}
          onServe={(served) => {
            setLineFor(null);
            void serve([lineFor.id], served);
          }}
          onRepeat={() => {
            setLineFor(null);
            if (closedForSale) {
              toast.show(NO_SALE);
              return;
            }
            void repeatItem(db, lineFor.id, waiter, new Date()).then(
              (again) => toast.show(`${itemLabel(again)} eklendi; göndermeyi unutmayın.`),
              () => toast.show('Tekrarlanamadı.'),
            );
          }}
          onTreat={() => {
            const item = lineFor;
            setLineFor(null);
            approval.ask('discount', () => {
              void setComplimentary(db, item.id, !item.complimentary, new Date());
            });
          }}
          onVoid={() => {
            const item = lineFor;
            setLineFor(null);
            approval.ask('voidSale', () => setVoiding(item));
          }}
        />
      ) : null}
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
            setSheet(null);
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
      {approval.dialog}
      <ToastRegion message={toast.message} action={toast.action} onDismiss={toast.dismiss} />
    </>
  );
}

/** The total left, holding back the next course, sending and the bill. */
function OrderActions({
  total,
  fresh,
  held,
  ready,
  canPay,
  sendLabel,
  onSend,
  onFire,
  onServe,
  onPay,
}: {
  total: number;
  fresh: number;
  held: number;
  /** Ready lines not yet taken to the table. */
  ready: number;
  canPay: boolean;
  sendLabel: string;
  onSend(): void;
  onFire(): void;
  onServe(): void;
  onPay(): void;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-semibold text-text-2">Kalan</span>
        <span
          aria-label="Kalan tutar"
          className="font-display text-figure font-bold tracking-[-0.02em]"
        >
          {formatTRY(total)}
        </span>
      </div>
      {ready > 0 ? (
        <Button className="border-success/50 text-success" onClick={onServe}>
          {`Hazırları servis et (${ready})`}
        </Button>
      ) : null}
      {held > 0 ? <Button onClick={onFire}>{`Bekleyenleri gönder (${held})`}</Button> : null}
      <Button
        variant="primary"
        size="lg"
        aria-label={sendLabel}
        disabled={fresh === 0}
        onClick={onSend}
      >
        Mutfağa gönder
        <CountBadge count={fresh} />
      </Button>
      <Button disabled={!canPay} onClick={onPay}>
        Hesap
      </Button>
    </div>
  );
}

/** A phone's bar under the thumb: the total opens the order, beside sending and the bill. */
function PhoneOrderBar({
  total,
  lines,
  fresh,
  canPay,
  sendLabel,
  onOpen,
  onSend,
  onPay,
}: {
  total: number;
  lines: number;
  fresh: number;
  canPay: boolean;
  sendLabel: string;
  onOpen(): void;
  onSend(): void;
  onPay(): void;
}): JSX.Element {
  const bar = useBottomBar<HTMLDivElement>();
  return (
    <>
      {/* Keeps the end of the menu clear of the fixed bar. */}
      <div aria-hidden="true" className="h-24" />
      <div
        ref={bar}
        className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-2 border-t border-line-strong bg-surface px-3 pt-2.5 pb-[calc(0.625rem+env(safe-area-inset-bottom))] shadow-raised"
      >
        <button
          type="button"
          onClick={onOpen}
          aria-label={`Adisyonu aç, ${lines} kalem`}
          className="flex min-h-12 min-w-0 flex-1 items-center gap-1.5 rounded-control pr-1 text-left hover:bg-bg"
        >
          <ChevronUp aria-hidden="true" size={18} className="shrink-0 text-text-2" />
          <span className="flex min-w-0 flex-col leading-tight">
            <span
              aria-label="Kalan tutar"
              className="truncate font-display text-lg font-bold tracking-[-0.02em]"
            >
              {formatTRY(total)}
            </span>
            <span className="truncate text-meta text-text-2">{`Adisyon · ${lines}`}</span>
          </span>
        </button>
        <Button
          variant="primary"
          className="px-3.5"
          aria-label={sendLabel}
          disabled={fresh === 0}
          onClick={onSend}
        >
          Gönder
          <CountBadge count={fresh} />
        </Button>
        <Button className="px-3.5" disabled={!canPay} onClick={onPay}>
          Hesap
        </Button>
      </div>
    </>
  );
}

function CountBadge({ count }: { count: number }): JSX.Element | null {
  return count > 0 ? (
    <span
      key={count}
      aria-hidden="true"
      className="flex h-6 min-w-6 animate-bump items-center justify-center rounded-chip bg-on-accent px-1.5 font-display text-sm font-bold text-accent"
    >
      {count}
    </span>
  ) : null;
}

/** A sent line's actions: one more of the same, a treat, or a void with its reason. */
function LineSheet({
  item,
  amount,
  canRepeat,
  onClose,
  onServe,
  onRepeat,
  onTreat,
  onVoid,
}: {
  item: TabItemRecord;
  amount: number | undefined;
  canRepeat: boolean;
  onClose(): void;
  onServe(served: boolean): void;
  onRepeat(): void;
  onTreat(): void;
  onVoid(): void;
}): JSX.Element {
  return (
    <Dialog
      open
      onOpenChange={(next) => !next && onClose()}
      title={itemLabel(item)}
      {...(amount !== undefined ? { description: formatTRY(amount) } : {})}
    >
      <div className="flex flex-col gap-2">
        {item.status === 'ready' ? (
          item.servedAt ? (
            <Button onClick={() => onServe(false)}>Servis edilmedi</Button>
          ) : (
            <Button variant="primary" onClick={() => onServe(true)}>
              Servis edildi
            </Button>
          )
        ) : null}
        <Button disabled={!canRepeat} onClick={onRepeat}>
          {item.unit === 'kg' ? 'Tekrarla' : 'Bir tane daha'}
        </Button>
        <Button onClick={onTreat}>{item.complimentary ? 'İkramı kaldır' : 'İkram'}</Button>
        <Button variant="danger" onClick={onVoid}>
          İptal
        </Button>
      </div>
    </Dialog>
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
