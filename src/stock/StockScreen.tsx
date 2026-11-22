import { useState, type JSX } from 'react';
import { useData, useSyncStatus } from '@/app/appData';
import { AppShell } from '@/app/AppShell';
import { NoAccessNote } from '@/app/NoAccessNote';
import { useSession } from '@/app/session';
import { ChoiceGroup, ToastRegion, useToast } from '@/design';
import type { ProductRecord } from '@/data/types';
import type { Permission } from '@/domain/permissions';
import { CriticalStock } from './CriticalStock';
import { ExpiringStock } from './ExpiringStock';
import { GoodsReceipt } from './GoodsReceipt';
import { StockCount } from './StockCount';
import { addProduct, loadDraft, saveDraft } from './receiptDraft';

type StockView = 'receive' | 'count' | 'critical' | 'expiry';

type Can = (permission: Permission) => boolean;

/**
 * Each view with who may open it: the count has its own permission, the levels are `stock`, and
 * goods received also needs `seeCost` (a receipt is a purchase invoice: prices, payment, supplier).
 */
const VIEWS: readonly { value: StockView; label: string; allowed: (can: Can) => boolean }[] = [
  { value: 'receive', label: 'Mal kabul', allowed: (can) => can('stock') && can('seeCost') },
  { value: 'count', label: 'Sayım', allowed: (can) => can('count') },
  { value: 'critical', label: 'Kritik stok', allowed: (can) => can('stock') },
  { value: 'expiry', label: 'SKT yaklaşanlar', allowed: (can) => can('stock') },
];

/**
 * Stock work without a screen around it: receiving goods, counting the shelf, the products that
 * are running out and the deliveries whose son kullanma tarihi is near. A person sees only the
 * views their permissions open.
 */
export function StockPanel(): JSX.Element {
  const { can } = useSession();
  const [picked, setPicked] = useState<StockView>();
  const toast = useToast();
  const allowed = VIEWS.filter((each) => each.allowed(can));
  const view = allowed.find((each) => each.value === picked)?.value ?? allowed[0]?.value;

  // The goods receipt reads its draft when it opens, so the product is written to the draft.
  function receive(product: ProductRecord) {
    saveDraft(addProduct(loadDraft(), product));
    setPicked('receive');
    toast.show(`${product.name} mal kabule eklendi.`);
  }

  if (view === undefined) {
    return <NoAccessNote />;
  }
  return (
    <>
      {allowed.length > 1 ? (
        <ChoiceGroup
          legend="Göster"
          name="stockView"
          options={allowed}
          value={view}
          onChange={(next) => setPicked(next)}
        />
      ) : null}
      {view === 'receive' ? <GoodsReceipt onDone={toast.show} /> : null}
      {view === 'count' ? <StockCount onDone={toast.show} /> : null}
      {view === 'critical' ? (
        <CriticalStock
          onReceive={allowed.some((each) => each.value === 'receive') ? receive : undefined}
        />
      ) : null}
      {view === 'expiry' ? <ExpiringStock /> : null}
      <ToastRegion message={toast.message} />
    </>
  );
}

/** The stock screen of the market's own menu. */
export function StockScreen(): JSX.Element {
  const { settings, runner } = useData();
  const status = useSyncStatus(runner);
  return (
    <AppShell
      marketName={settings.marketName}
      deviceName={settings.deviceName}
      syncState={status.state}
      pendingCount={status.pendingCount}
      syncError={status.error}
      activeNav="stock"
    >
      <h1 className="text-xl font-semibold">Stok</h1>
      <StockPanel />
    </AppShell>
  );
}
