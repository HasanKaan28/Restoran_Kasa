import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { saveServerLicense } from '@/data/license';
import { createTestData, disposeTestData, renderWithData } from '@/test/renderWithData';
import { LicenseSection } from './MarketSections';

afterEach(disposeTestData);

describe('LicenseSection', () => {
  it('shows the plan and a licence without an end, as for a market opened before codes', async () => {
    const data = createTestData();
    await saveServerLicense(data.db, {
      plan: 'restoran',
      planName: 'Restoran',
      maxDevices: 5,
      licenseExpiresAt: null,
    });
    await renderWithData(<LicenseSection />, data);
    const section = screen.getByRole('region', { name: 'Lisans' });
    expect(await within(section).findByText('Süresiz.')).toBeInTheDocument();
    expect(within(section).getByText('Paket: Restoran · en çok 5 cihaz')).toBeInTheDocument();
  });

  it('shows the last day of a licence that ends, on an unlimited plan', async () => {
    const data = createTestData();
    await saveServerLicense(data.db, {
      plan: 'pro',
      planName: 'Restoran Pro',
      maxDevices: null,
      licenseExpiresAt: '2030-12-20T12:00:00Z',
    });
    await renderWithData(<LicenseSection />, data);
    const section = screen.getByRole('region', { name: 'Lisans' });
    expect(await within(section).findByText(/^Son gün/)).toBeInTheDocument();
    expect(within(section).getByText('Paket: Restoran Pro · sınırsız cihaz')).toBeInTheDocument();
  });
});
