import { Capacitor } from '@capacitor/core';
import { useSyncExternalStore, type JSX } from 'react';
import { ChoiceGroup, type ChoiceOption } from '@/design';
import { SettingsSection } from '@/settings/MarketSections';
import type { SlipMode } from './orderSlip';
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
 * with the printer, the bar's or the till's PC), and which orders. Off unless chosen here.
 */
export function OrderSlipSection(): JSX.Element {
  const prefs = useSyncExternalStore(subscribeSlipPrefs, slipPrefsSnapshot);
  return (
    <SettingsSection
      id="slip-heading"
      title="Sipariş adisyonu"
      description="Garson siparişi girince bu cihaz adisyon basar: ürünler ve adetler, giren kişi, masa, saat ve tarih. Yalnız yazıcının bağlı olduğu cihazda açın; açıldığı andan önceki siparişler basılmaz. Bu cihaza özeldir."
    >
      <ChoiceGroup<SlipMode>
        legend="Siparişte adisyon bas"
        name="order-slip"
        options={MODES}
        value={prefs.mode}
        onChange={(mode) => chooseSlipMode(mode, new Date())}
        wrap
      />
      <p className="text-sm text-text-2">{MODE_TEXT[prefs.mode]}</p>
      <p className="text-sm text-muted">{printerNote()}</p>
    </SettingsSection>
  );
}

/** How this device prints: on its own, through the browser's window, or not at all. */
function printerNote(): string {
  if ((window as { marketKasa?: { print?: unknown } }).marketKasa?.print) {
    return 'Bu bilgisayar adisyonu pencere açmadan varsayılan yazıcıya basar; Windows’ta adisyon yazıcısını varsayılan yapın. Kâğıt genişliği Fiş ayarlarından gelir.';
  }
  if (Capacitor.isNativePlatform()) {
    return 'Android uygulaması yazıcıya basamaz; adisyonu yazıcının bağlı olduğu bilgisayarda açın.';
  }
  return 'Tarayıcıda her adisyonda yazdırma penceresi açılır. Pencere açmadan basmak için Windows uygulamasını kullanın. Kâğıt genişliği Fiş ayarlarından gelir.';
}
