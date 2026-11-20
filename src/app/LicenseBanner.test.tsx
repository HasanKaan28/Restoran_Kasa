import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { saveServerLicense } from '@/data/license';
import { LicenseExpiredError } from '@/sync/supabaseTransport';
import { createTestData, disposeTestData, renderWithData } from '@/test/renderWithData';
import { LicenseBanner } from './LicenseBanner';

afterEach(async () => {
  vi.useRealTimers();
  await disposeTestData();
});

/** The register as it is after a pull: the server's licence end kept with the market's data. */
async function licensed(licenseExpiresAt: string | null) {
  const data = createTestData();
  await saveServerLicense(data.db, {
    plan: 'restoran',
    planName: 'Restoran',
    maxDevices: 5,
    licenseExpiresAt,
  });
  return data;
}

describe('LicenseBanner', () => {
  it('counts the last days down and offers to write to the seller', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-12-17T09:00:00Z'));
    await renderWithData(
      <LicenseBanner marketName="Kebapçı Halil" supportNumber="905321112233" />,
      await licensed('2026-12-20T12:00:00Z'),
    );
    expect(await screen.findByText('Lisansın bitmesine 3 gün kaldı.')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Lisansı uzatmak için WhatsApp’tan yazın' });
    expect(link.getAttribute('href')).toBe(
      `https://wa.me/905321112233?text=${encodeURIComponent(
        'Merhaba, Kebapçı Halil için Restoran Kasa lisansımı uzatmak istiyorum.',
      )}`,
    );
  });

  it('explains a sync the server refused because the licence ended', async () => {
    await renderWithData(
      <LicenseBanner
        marketName="Kebapçı Halil"
        syncError={new LicenseExpiredError().message}
        supportNumber={null}
      />,
      await licensed('2026-01-01T12:00:00Z'),
    );
    expect(
      await screen.findByText(/bu cihaz sunucuyla eşitlenmiyor. Kayıtlar cihazda güvende/),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Lisansı uzatmak için satıcınızla iletişime geçin.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('shows nothing for a licence without an end, as for a market opened before codes', async () => {
    await renderWithData(
      <LicenseBanner marketName="Grenn Bar" supportNumber="905321112233" />,
      await licensed(null),
    );
    // Let the stored licence load before looking.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });
});
