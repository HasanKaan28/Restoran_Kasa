import type { JSX } from 'react';
import { LicenseExpiredError } from '@/sync/supabaseTransport';
import { useLicense } from './license';
import { SUPPORT } from './support';
import { SupportLink } from './SupportLink';

export type LicenseBannerProps = {
  marketName: string;
  /** Why the last sync failed: the server's refusal of an ended licence is explained here. */
  syncError?: string;
  /** The seller's WhatsApp number; this build's by default. */
  supportNumber?: string | null;
};

const REFUSED = new LicenseExpiredError().message;

/**
 * A line under the shell's header while the licence nears its end, is in grace, has run out, or
 * the server refuses to sync because of it, with a way to write to the seller about extending it.
 */
export function LicenseBanner({
  marketName,
  syncError,
  supportNumber,
}: LicenseBannerProps): JSX.Element | null {
  const license = useLicense();
  const refused = syncError === REFUSED;
  const text = refused
    ? 'Lisans süresi doldu; bu cihaz sunucuyla eşitlenmiyor. Kayıtlar cihazda güvende; lisans uzatılınca eşitleme kendiliğinden sürer.'
    : license.kind === 'warning'
      ? license.daysLeft === 0
        ? 'Lisans bugün bitiyor.'
        : `Lisansın bitmesine ${license.daysLeft} gün kaldı.`
      : license.kind === 'grace'
        ? license.graceDaysLeft === 0
          ? 'Lisans süresi doldu. Satış için bugün son gün.'
          : `Lisans süresi doldu. Satış ${license.graceDaysLeft} gün daha açık; sonra kapanır.`
        : license.kind === 'readOnly'
          ? 'Lisans süresi doldu. Satış kapalı; veriler okunabilir ve dışa aktarılabilir.'
          : null;
  if (text === null) {
    return null;
  }
  const tone =
    refused || license.kind === 'readOnly'
      ? 'bg-danger-bg text-danger'
      : 'bg-warning-bg text-warning';
  return (
    <div
      className={`flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-1.5 text-sm md:px-6 ${tone}`}
    >
      <p role="status" className="py-1 font-medium">
        {text}
      </p>
      <SupportLink
        topic={SUPPORT.license(marketName)}
        {...(supportNumber === undefined ? {} : { number: supportNumber })}
        inheritColor
      />
    </div>
  );
}
