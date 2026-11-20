import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { loadDismissedAnnouncements, saveServerAnnouncements } from '@/data/announcements';
import { createTestData, disposeTestData, renderWithData } from '@/test/renderWithData';
import { AnnouncementBanner } from './AnnouncementBanner';

afterEach(async () => {
  await disposeTestData();
});

describe('AnnouncementBanner', () => {
  it('shows the seller’s messages until one is closed on this register', async () => {
    const data = createTestData();
    await saveServerAnnouncements(data.db, [
      { id: 'b', message: 'Faturanız hazır.', createdAt: '2026-11-27T10:00:00Z' },
      { id: 'a', message: 'Yarın 02:00’de bakım var.', createdAt: '2026-11-27T09:00:00Z' },
    ]);
    await renderWithData(<AnnouncementBanner />, data);

    expect(await screen.findByText('Faturanız hazır.')).toBeInTheDocument();
    expect(screen.getByText('Yarın 02:00’de bakım var.')).toBeInTheDocument();
    await userEvent.click(
      screen.getAllByRole('button', { name: 'Duyuruyu kapat' })[0] as HTMLElement,
    );
    await waitFor(() => expect(screen.queryByText('Faturanız hazır.')).toBeNull());
    expect(screen.getByText('Yarın 02:00’de bakım var.')).toBeInTheDocument();
    expect(await loadDismissedAnnouncements(data.db)).toEqual(['b']);
  });

  it('shows nothing without announcements', async () => {
    const { container } = await renderWithData(<AnnouncementBanner />, createTestData());
    expect(container).toBeEmptyDOMElement();
  });
});
