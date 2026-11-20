import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { archiveStaff, createStaff } from '@/data/staff';
import { createTestData, renderWithData } from '@/test/renderWithData';
import { AppShell } from './AppShell';
import { SessionProvider } from './SessionProvider';
import { resumeStaffSession, startStaffSession } from './staffSession';

const at = new Date('2026-10-29T09:00:00Z');

async function staffData() {
  const data = createTestData();
  const kaan = await createStaff(data.db, { name: 'Kaan', role: 'owner', pin: '4821' }, at);
  const ayse = await createStaff(data.db, { name: 'Ayşe', role: 'cashier', pin: '1234' }, at);
  return { data, kaan, ayse };
}

function Shell() {
  return (
    <AppShell marketName="Bakkal" deviceName="Kasa 1" syncState="online" activeNav="pos">
      <p>Kasa ekranı</p>
    </AppShell>
  );
}

describe('SessionProvider', () => {
  it('asks for a PIN when staff are set up', async () => {
    const { data, ayse } = await staffData();
    await renderWithData(
      <SessionProvider>
        <Shell />
      </SessionProvider>,
      data,
    );
    expect(await screen.findByRole('heading', { name: 'Kim çalışıyor?' })).toBeInTheDocument();
    expect(screen.queryByText('Kasa ekranı')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Ayşe/ }));
    await userEvent.type(screen.getByLabelText('PIN'), '0000');
    await userEvent.click(screen.getByRole('button', { name: 'Giriş' }));
    expect(await screen.findByText('PIN yanlış. 4 deneme kaldı.')).toBeInTheDocument();
    for (const digit of ['1', '2', '3', '4']) {
      await userEvent.click(screen.getByRole('button', { name: digit }));
    }
    await userEvent.click(screen.getByRole('button', { name: 'Giriş' }));
    expect(await screen.findByText('Kasa ekranı')).toBeInTheDocument();
    await waitFor(() => expect(localStorage.getItem('rk.staff')).toContain(ayse.id));
    expect(await resumeStaffSession(data.db)).toBe(ayse.id);
  });

  it('asks for the PIN when only a person’s id was written into the storage', async () => {
    // Every register has every id in its synced rows: an id alone must not open the register.
    const { data, kaan } = await staffData();
    localStorage.setItem('rk.staff', kaan.id);
    await renderWithData(
      <SessionProvider>
        <Shell />
      </SessionProvider>,
      data,
    );
    expect(await screen.findByRole('heading', { name: 'Kim çalışıyor?' })).toBeInTheDocument();
    expect(screen.queryByText('Kasa ekranı')).not.toBeInTheDocument();
  });

  it('opens straight in when no staff are set up', async () => {
    await renderWithData(
      <SessionProvider>
        <Shell />
      </SessionProvider>,
    );
    expect(await screen.findByText('Kasa ekranı')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Kilitle' })).not.toBeInTheDocument();
  });

  it('signs out with Kilitle', async () => {
    const { data, ayse } = await staffData();
    await startStaffSession(data.db, ayse);
    await renderWithData(
      <SessionProvider>
        <Shell />
      </SessionProvider>,
      data,
    );
    expect(await screen.findByText('Ayşe')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Kilitle' }));
    expect(await screen.findByRole('heading', { name: 'Kim çalışıyor?' })).toBeInTheDocument();
    await waitFor(() => expect(localStorage.getItem('rk.staff')).toBeNull());
    expect(await resumeStaffSession(data.db)).toBeNull();
  });

  it('leaves a session whose person was archived', async () => {
    const { data, ayse } = await staffData();
    await startStaffSession(data.db, ayse);
    await renderWithData(
      <SessionProvider>
        <Shell />
      </SessionProvider>,
      data,
    );
    expect(await screen.findByText('Kasa ekranı')).toBeInTheDocument();
    await archiveStaff(data.db, ayse.id, new Date());
    expect(await screen.findByRole('heading', { name: 'Kim çalışıyor?' })).toBeInTheDocument();
  });
});
