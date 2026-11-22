import { useLiveQuery } from 'dexie-react-hooks';
import { Plus } from 'lucide-react';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type JSX,
} from 'react';
import { useActor } from '@/app/actor';
import { useData } from '@/app/appData';
import { useSession } from '@/app/session';
import { createCategory, listCategories, MAX_CATEGORY_NAME_LENGTH } from '@/data/categories';
import { DuplicateBarcodeError } from '@/data/errors';
import { createProduct, deleteProduct, restoreProduct, updateProduct } from '@/data/products';
import { stockOf } from '@/data/stock';
import type { ProductRecord, Station } from '@/data/types';
import { Button, ChoiceGroup, Dialog, SelectField, TextField } from '@/design';
import { MenuOptionsEditor } from '@/restaurant/MenuOptionsEditor';
import { formatStock, UNIT_LABELS, VAT_OPTIONS } from '@/pos/format';
import { useBarcodeScanner } from '@/pos/keyboard';
import { AdjustStockDialog } from '@/stock/AdjustStockDialog';
import { MovementsDialog } from '@/stock/MovementsDialog';
import { saveCategoryName } from './categoryName';
import { suggestProductName } from './openFoodFacts';
import {
  draftOf,
  editedFields,
  fractionalStockError,
  profitHint,
  readDraft,
  STATION_OPTIONS,
  UNIT_OPTIONS,
  type DraftErrors,
  type ProductDraft,
} from './productForm';

export type ProductFormDialogProps = {
  open: boolean;
  /** The product to edit; without one the form adds a new product. */
  product?: ProductRecord;
  /** A scanned barcode for a new product. */
  barcode?: string;
  /**
   * Whether a new product is asked for the stock on the shelf; a goods receipt says no, as its
   * own line brings the delivered stock in and asking would count it twice.
   */
  askOpeningStock?: boolean;
  onClose(): void;
  /** Called with the message to show once the change is saved. */
  onSaved(message: string): void;
  /** Called with the product's id once it is added, saved or brought back. */
  onProductSaved?(productId: string): void;
};

type Errors = DraftErrors & { form?: string };

// Product barcodes (EAN-8 to GTIN-14) are worth looking up; a shop's own short codes are not.
const LOOKUP_BARCODE = /^\d{8,14}$/;

const LOOKUP_FAILURES = {
  'not-found': 'Bu barkod için ad bulunamadı.',
  offline: 'İnternet bağlantısı yok.',
  timeout: 'Yanıt gecikti, sonra yeniden deneyin.',
  unavailable: 'Ürün veritabanına şu an ulaşılamıyor.',
} as const;

/** Adds or edits a product with every field the catalogue keeps; also deletes and restores. */
export function ProductFormDialog({
  open,
  product,
  barcode,
  askOpeningStock = true,
  onClose,
  onSaved,
  onProductSaved,
}: ProductFormDialogProps): JSX.Element {
  const { db } = useData();
  const { can } = useSession();
  const actor = useActor();
  const [opened] = useState(() => draftOf(product, barcode));
  const [draft, setDraft] = useState(opened);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [stockDialog, setStockDialog] = useState<'adjust' | 'movements' | null>(null);
  const [stockNote, setStockNote] = useState<string>();
  // The market's fields (VAT, cost, barcode, stock) fold away unless this dish already uses them.
  const [advanced, setAdvanced] = useState(
    () =>
      Boolean(barcode) ||
      Boolean(
        product && (product.barcode || product.buyPrice > 0 || product.criticalLevelMilli > 0),
      ),
  );
  const formId = useId();
  const categories = useLiveQuery(() => listCategories(db), [db]);
  const productId = product?.id;
  const stockMilli = useLiveQuery(
    () => (productId === undefined ? undefined : stockOf(db, productId)),
    [db, productId],
  );

  useBarcodeScanner((code) => {
    if (open) {
      set('barcode', code);
    }
  });

  function set<K extends keyof ProductDraft>(key: K, value: ProductDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  // A category deleted elsewhere is shown, and saved, as none. Until the list loads, the stored
  // category stands, so a quick save never drops it.
  const categoryId =
    categories === undefined || categories.some((category) => category.id === draft.categoryId)
      ? draft.categoryId
      : '';

  async function run(action: () => Promise<string>, failure: string) {
    setBusy(true);
    try {
      onSaved(await action());
    } catch (error) {
      const taken =
        error instanceof DuplicateBarcodeError
          ? `Bu barkod “${error.holderName}” ürününde kayıtlı.`
          : undefined;
      const onPack =
        error instanceof DuplicateBarcodeError &&
        draft.packs.some((pack) => pack.barcode.trim().toUpperCase() === error.barcode);
      setErrors(
        taken === undefined
          ? { form: failure }
          : onPack
            ? { packs: `${(error as DuplicateBarcodeError).barcode}: ${taken}` }
            : { barcode: taken },
      );
    } finally {
      setBusy(false);
    }
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const read = readDraft({ ...draft, categoryId });
    if ('errors' in read) {
      setErrors(read.errors);
      return;
    }
    // Pieces are counted whole: a weighed product keeps its unit until its stock is whole.
    if (
      product &&
      product.unit !== 'piece' &&
      draft.unit === 'piece' &&
      stockMilli !== undefined &&
      stockMilli % 1000 !== 0
    ) {
      setErrors({ form: fractionalStockError(stockMilli, product.unit) });
      return;
    }
    setErrors({});
    void run(async () => {
      if (product) {
        const patch = editedFields(opened, draft, read.fields);
        if (Object.keys(patch).length === 0) {
          return 'Değişiklik yok.';
        }
        await updateProduct(db, product.id, patch, new Date(), actor);
        onProductSaved?.(product.id);
        return 'Ürün kaydedildi.';
      }
      const created = await createProduct(db, read.fields, new Date(), {
        openingStockMilli: read.openingStockMilli,
        staffId: actor.staffId,
        cutoffMinutes: actor.cutoffMinutes,
      });
      onProductSaved?.(created.id);
      return 'Ürün eklendi.';
    }, 'Ürün kaydedilemedi.');
  }

  const deleted = Boolean(product?.deletedAt);
  const advancedError = ADVANCED_FIELDS.some((field) => errors[field] !== undefined);
  const categoryOptions = [
    { value: '', label: 'Kategorisiz' },
    ...(categories ?? []).map((category) => ({ value: category.id, label: category.name })),
  ];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={product ? 'Ürünü düzenle' : 'Yeni ürün'}
      {...(deleted
        ? {}
        : {
            footer: (
              <Button type="submit" form={formId} variant="primary" size="lg" disabled={busy}>
                Kaydet
              </Button>
            ),
          })}
    >
      {product && deleted ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-line bg-bg p-3">
          <p className="font-medium">Bu ürün silinmiş.</p>
          <Button
            variant="primary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await restoreProduct(db, product.id, new Date());
                onProductSaved?.(product.id);
                return 'Ürün geri getirildi.';
              }, 'Ürün geri getirilemedi.')
            }
          >
            Geri getir
          </Button>
        </div>
      ) : null}
      <form id={formId} noValidate className="flex flex-col gap-4" onSubmit={save}>
        {/* A deleted product is only shown; bringing it back is the one thing to do with it. */}
        <fieldset disabled={deleted} className="flex min-w-0 flex-col gap-4">
          <TextField
            label="Ürün adı"
            autoFocus
            autoComplete="off"
            value={draft.name}
            error={errors.name}
            onChange={(event) => set('name', event.target.value)}
          />
          <TextField
            label="Satış fiyatı"
            hint="Örnek: 12,50"
            inputMode="decimal"
            autoComplete="off"
            value={draft.sellPrice}
            error={errors.sellPrice}
            onChange={(event) => set('sellPrice', event.target.value)}
          />
          <div className="flex flex-col gap-2">
            <SelectField
              label="Kategori"
              value={categoryId}
              options={categoryOptions}
              onChange={(event) => set('categoryId', event.target.value)}
            />
            <NewCategory onCreated={(id) => set('categoryId', id)} />
          </div>
          <ChoiceGroup<Station>
            legend="Hazırlandığı yer"
            name="station"
            options={STATION_OPTIONS}
            value={draft.station}
            onChange={(station) => set('station', station)}
          />
          <MenuOptionsEditor
            portions={draft.portions}
            groups={draft.optionGroups}
            {...(errors.menu ? { error: errors.menu } : {})}
            onPortions={(portions) => set('portions', portions)}
            onGroups={(groups) => set('optionGroups', groups)}
          />
          <details
            open={advanced || advancedError}
            onToggle={(event) => setAdvanced(event.currentTarget.open)}
            className="group rounded-plate border border-line"
          >
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 px-4 font-semibold">
              Gelişmiş
              <span className="text-sm font-normal text-text-2">
                KDV, alış fiyatı, barkod, stok
              </span>
            </summary>
            <div className="flex flex-col gap-4 border-t border-line p-4">
              <ChoiceGroup
                legend="KDV oranı"
                name="vatRate"
                options={VAT_OPTIONS}
                value={draft.vatRate}
                onChange={(rate) => set('vatRate', rate)}
              />
              {/* Cost is for whoever sees costs; without it the product keeps the buy price it has. */}
              {can('seeCost') ? (
                <TextField
                  label="Alış fiyatı"
                  hint={profitHint(draft) ?? 'Boş bırakılabilir.'}
                  inputMode="decimal"
                  autoComplete="off"
                  value={draft.buyPrice}
                  error={errors.buyPrice}
                  onChange={(event) => set('buyPrice', event.target.value)}
                />
              ) : null}
              <TextField
                label="Barkod"
                hint="Okutun ya da yazın; boş bırakılabilir."
                className="font-mono"
                spellCheck={false}
                autoComplete="off"
                value={draft.barcode}
                error={errors.barcode}
                onChange={(event) => set('barcode', event.target.value)}
              />
              {LOOKUP_BARCODE.test(draft.barcode.trim()) ? (
                <NameSuggestion
                  key={draft.barcode.trim()}
                  barcode={draft.barcode.trim()}
                  name={draft.name}
                  onUse={(name) => set('name', name)}
                />
              ) : null}
              <ChoiceGroup
                legend="Birim"
                name="unit"
                options={UNIT_OPTIONS}
                value={draft.unit}
                onChange={(unit) => set('unit', unit)}
              />
              <TextField
                label="Kritik stok"
                hint="Stok bu miktara inince uyarı verilir. Boş bırakılırsa uyarı yok."
                inputMode="decimal"
                autoComplete="off"
                value={draft.criticalLevel}
                error={errors.criticalLevel}
                onChange={(event) => set('criticalLevel', event.target.value)}
              />
              {product ? (
                <div className="flex flex-col gap-1">
                  {stockMilli === undefined ? null : (
                    <p className="font-medium">{`Stok: ${formatStock(stockMilli, product.unit)}`}</p>
                  )}
                  {stockNote ? (
                    <p role="status" className="text-sm font-medium text-success">
                      {stockNote}
                    </p>
                  ) : null}
                  <p className="text-sm text-muted">
                    Stok, mal kabul, sayım ve düzeltmeyle değişir.
                  </p>
                  {deleted ? null : (
                    <div className="flex flex-wrap gap-2">
                      {can('stock') ? (
                        <Button onClick={() => setStockDialog('adjust')}>Stoğu düzelt</Button>
                      ) : null}
                      <Button onClick={() => setStockDialog('movements')}>Hareketler</Button>
                    </div>
                  )}
                </div>
              ) : askOpeningStock ? (
                <TextField
                  label="Başlangıç stoğu"
                  hint={`Rafta şu an kaç ${UNIT_LABELS[draft.unit]} var?`}
                  inputMode="decimal"
                  autoComplete="off"
                  value={draft.openingStock}
                  error={errors.openingStock}
                  onChange={(event) => set('openingStock', event.target.value)}
                />
              ) : null}
              <label className="flex min-h-11 cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  checked={draft.isQuick}
                  onChange={(event) => set('isQuick', event.target.checked)}
                  className="size-5 accent-accent"
                />
                Hızlı ürünlere ekle
              </label>
            </div>
          </details>
        </fieldset>
        {errors.form ? (
          <p role="alert" className="font-medium text-danger">
            {errors.form}
          </p>
        ) : null}
      </form>
      {product && !deleted ? (
        confirmingDelete ? (
          <div className="flex flex-col gap-3 rounded-control border border-line p-3">
            <p className="font-medium">Bu ürün silinsin mi? Satış geçmişi korunur.</p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="danger"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await deleteProduct(db, product.id, new Date());
                    return 'Ürün silindi.';
                  }, 'Ürün silinemedi.')
                }
              >
                Sil
              </Button>
              <Button onClick={() => setConfirmingDelete(false)}>Vazgeç</Button>
            </div>
          </div>
        ) : (
          <Button variant="danger" onClick={() => setConfirmingDelete(true)}>
            Ürünü sil
          </Button>
        )
      ) : null}
      {product && stockDialog === 'movements' ? (
        <MovementsDialog open product={product} onClose={() => setStockDialog(null)} />
      ) : null}
      {product && stockDialog === 'adjust' ? (
        <AdjustStockDialog
          open
          product={product}
          onClose={() => setStockDialog(null)}
          // The stock is saved on its own; the form stays open with whatever is typed in it.
          onDone={(message) => {
            setStockDialog(null);
            setStockNote(message);
          }}
        />
      ) : null}
    </Dialog>
  );
}

type Lookup =
  | { kind: 'idle' }
  | { kind: 'asking' }
  | { kind: 'offer'; name: string }
  | { kind: 'failed'; message: string };

/**
 * Asks Open Food Facts for the barcode's product name, only when the button is pressed. An empty
 * name box takes the answer at once; a name typed before or during the wait stays until the user
 * picks "Kullan". It is keyed by barcode, so a changed barcode drops a pending answer.
 */
function NameSuggestion({
  barcode,
  name,
  onUse,
}: {
  barcode: string;
  name: string;
  onUse(name: string): void;
}): JSX.Element {
  const [lookup, setLookup] = useState<Lookup>({ kind: 'idle' });
  // The name as it is when the answer comes back, and whether this barcode is still the one asked.
  const latestName = useRef(name);
  const current = useRef(true);
  useLayoutEffect(() => {
    latestName.current = name;
  });
  useEffect(() => {
    current.current = true;
    return () => {
      current.current = false;
    };
  }, []);

  async function ask() {
    setLookup({ kind: 'asking' });
    const result = await suggestProductName(barcode);
    if (!current.current) {
      return;
    }
    if ('error' in result) {
      setLookup({ kind: 'failed', message: LOOKUP_FAILURES[result.error] });
    } else if (latestName.current.trim() !== '') {
      setLookup({ kind: 'offer', name: result.name });
    } else {
      onUse(result.name);
      setLookup({ kind: 'idle' });
    }
  }

  return (
    <div className="-mt-2 flex flex-col items-start gap-1">
      <Button variant="ghost" disabled={lookup.kind === 'asking'} onClick={() => void ask()}>
        İnternetten ad öner
      </Button>
      {lookup.kind === 'offer' ? (
        <div className="flex flex-wrap items-center gap-2">
          <p>{`Öneri: ${lookup.name}`}</p>
          <Button
            onClick={() => {
              onUse(lookup.name);
              setLookup({ kind: 'idle' });
            }}
          >
            Kullan
          </Button>
        </div>
      ) : null}
      <p role="status" className="text-sm text-text-2">
        {lookup.kind === 'failed' ? lookup.message : lookup.kind === 'asking' ? 'Aranıyor…' : ''}
      </p>
    </div>
  );
}

/** The fields under "Gelişmiş": an error in one opens it, so the message is never hidden. */
const ADVANCED_FIELDS = ['barcode', 'buyPrice', 'criticalLevel', 'openingStock'] as const;

/** A category made in place, from the dish's own form, and chosen for it at once. */
function NewCategory({ onCreated }: { onCreated(id: string): void }): JSX.Element {
  const { db } = useData();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string>();

  async function add() {
    let id: string | undefined;
    const problem = await saveCategoryName(async () => {
      id = (await createCategory(db, name, new Date())).id;
    }, name);
    setError(problem);
    if (id !== undefined) {
      onCreated(id);
      setName('');
      setAdding(false);
    }
  }

  if (!adding) {
    return (
      <Button
        variant="ghost"
        className="self-start"
        icon={<Plus aria-hidden="true" size={18} />}
        onClick={() => setAdding(true)}
      >
        Yeni kategori
      </Button>
    );
  }
  return (
    <div className="flex items-end gap-2">
      <div className="min-w-0 flex-1">
        <TextField
          label="Yeni kategori adı"
          autoFocus
          autoComplete="off"
          maxLength={MAX_CATEGORY_NAME_LENGTH}
          value={name}
          error={error}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            // Inside the dish's form: Enter adds the category instead of saving the dish.
            if (event.key === 'Enter') {
              event.preventDefault();
              void add();
            }
          }}
        />
      </div>
      <Button className={error ? 'mb-7' : ''} onClick={() => void add()}>
        Ekle
      </Button>
    </div>
  );
}
