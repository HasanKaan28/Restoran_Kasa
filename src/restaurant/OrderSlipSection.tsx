import { Capacitor } from '@capacitor/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { useSyncExternalStore, type JSX } from 'react';
import { useData } from '@/app/appData';
import { Button, ChoiceGroup, type ChoiceOption } from '@/design';
import { loadReceiptSettings } from '@/pos/receiptSettings';
import { SettingsSection } from '@/settings/MarketSections';
import { lastSlip, type SlipMode } from './orderSlip';
import { printOrderSlips, printsSilently } from './printOrderSlips';
import { chooseSlipMode, slipPrefsSnapshot, subscribeSlipPrefs } from './slipPrefs';

const MODES: readonly ChoiceOption<SlipMode>[] = [
  { value: 'off', label: 'Kapalı' },
  { value: 'delivered', label: 'Yalnız teslim edilenler' },
  { value: 'all', label: 'Tüm siparişler' },
];

const MODE_TEXT: Record<SlipMode, string> = {
  off: 'Bu cihaz sipariş adisyonu basmaz.',
  delivered:
    '“Teslim edildi” ile verilen her sipariş, hangi cihazdan girilirse girilsin, burada bir kez basılır.',
  all: 'Mutfağa ya da bara gönderilen ve teslim edilen her sipariş burada bir kez basılır.',
};

/**
 * This device's order slips: whether it prints one for each order as it comes in (the device
 * with the printer, the bar's or the till's PC), and which orders. Off unless chosen here. The
 * latest slip printed can be printed again (a jammed roll, a torn slip).
 */
export function OrderSlipSection(): JSX.Element {
  const { db, settings } = useData();
  const prefs = useSyncExternalStore(subscribeSlipPrefs, slipPrefsSnapshot);
  const latest = useLiveQuery(() => lastSlip(db), [db]);
  const cannotPrint = !printsSilently() && Capacitor.isNativePlatform();
  return (
    <SettingsSection
      id="slip-heading"
      title="Sipariş adisyonu"
      description="Garson siparişi girince bu cihaz adisyon basar: ürünler ve adetler, giren kişi, masa, saat ve tarih. Yalnız yazıcının bağlı olduğu cihazda açın; açıldığı andan önceki siparişler basılmaz. Bu cihaza özeldir."
      action={
        <Button
          disabled={!latest || cannotPrint}
          onClick={() => {
            if (latest) {
              void printOrderSlips([latest], loadReceiptSettings().paperWidth);
            }
          }}
        >
          Son adisyonu tekrar bas
        </Button>
      }
    >
      {/* The Android app has no way to print: the choice stays as it is. */}
      <fieldset disabled={cannotPrint} className="min-w-0 disabled:opacity-60">
        <ChoiceGroup<SlipMode>
          legend="Siparişte adisyon bas"
          name="order-slip"
          options={MODES}
          value={prefs.mode}
          onChange={(mode) => chooseSlipMode(mode, new Date(), settings.marketId)}
          wrap
        />
      </fieldset>
      <p className="text-sm text-text-2">{MODE_TEXT[prefs.mode]}</p>
      <p className="text-sm text-muted">{printerNote(cannotPrint)}</p>
    </SettingsSection>
  );
}

/** How this device prints: on its own, through the browser's window, or not at all. */
function printerNote(cannotPrint: boolean): string {
  if (cannotPrint) {
    return 'Android uygulaması yazıcıya basamaz; adisyonu yazıcının bağlı olduğu bilgisayarda açın.';
  }
  if (printsSilently()) {
    return 'Bu bilgisayar adisyonu pencere açmadan varsayılan yazıcıya basar; Windows’ta adisyon yazıcısını varsayılan yapın. Kâğıt genişliği Fiş ayarlarından gelir.';
  }
  return 'Tarayıcıda her adisyonda yazdırma penceresi açılır. Pencere açmadan basmak için Windows uygulamasını kullanın. Kâğıt genişliği Fiş ayarlarından gelir.';
}
