import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { SessionProvider } from '@/app/SessionProvider';
import { createCustomer } from '@/data/customers';
import { createStaff } from '@/data/staff';
import type { Permission } from '@/domain/permissions';
import { createTestData, renderWithData } from '@/test/renderWithData';
import { signInAs } from '@/test/session';
import { CreditSection } from './CreditSection';

const before = () => new Date(Date.now() - 60_000);

async function team(grant: Partial<Record<Permission, boolean>>) {
  const data = createTestData();
  const kaan = await createStaff(data.db, { name: 'Kaan', role: 'owner', pin: '4821' }, before());
  const waiter = await createStaff(
    data.db,
    { name: 'Ayşe', role: 'cashier', pin: '1234', permissions: grant },
    before(),
  );
  return { data, kaan, waiter };
}

async function show(data: Awaited<ReturnType<typeof team>>['data'], staffId: string) {
  await signInAs(data.db, staffId);
  await renderWithData(
    <SessionProvider>
      <CreditSection />
    </SessionProvider>,
    data,
  );
}

afterEach(() => {
  window.location.hash = '';
});

describe('CreditSection', () => {
  it('lists the customers and never offers the v1 import, even to the owner', async () => {
    const { data, kaan } = await team({});
    await createCustomer(data.db, { name: 'Ahmet' }, before());
    await show(data, kaan.id);
    expect(
      await screen.findByRole('button', { name: 'Ahmet' }, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Yeni müşteri' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: "v1'den aktar" })).toBeNull();
  });

  it('keeps collecting from a person who may only sell on credit', async () => {
    const { data, waiter } = await team({ creditSale: true });
    await createCustomer(data.db, { name: 'Ahmet' }, before());
    await show(data, waiter.id);
    await userEvent.click(await screen.findByRole('button', { name: 'Ahmet' }));
    const dialog = await screen.findByRole('dialog', { name: 'Ahmet' });
    expect(within(dialog).getByRole('button', { name: 'Düzeltme' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Tahsilat al' })).toBeNull();
  });

  it('lets a person who collects take a payment', async () => {
    const { data, waiter } = await team({ collect: true });
    await createCustomer(data.db, { name: 'Ahmet' }, before());
    await show(data, waiter.id);
    await userEvent.click(await screen.findByRole('button', { name: 'Ahmet' }));
    const dialog = await screen.findByRole('dialog', { name: 'Ahmet' });
    expect(await within(dialog).findByRole('button', { name: 'Tahsilat al' })).toBeEnabled();
  });

  it('asks a manager before a new customer is given a credit limit', async () => {
    const { data, waiter } = await team({ creditSale: true });
    await show(data, waiter.id);
    await userEvent.click(await screen.findByRole('button', { name: 'Yeni müşteri' }));
    const form = await screen.findByRole('dialog', { name: 'Yeni müşteri' });
    await userEvent.type(within(form).getByLabelText('Ad'), 'Veli');
    await userEvent.type(within(form).getByLabelText('Limit'), '5000');
    await userEvent.click(within(form).getByRole('button', { name: 'Kaydet' }));
    expect(await screen.findByRole('dialog', { name: 'Yetkili onayı' })).toBeInTheDocument();
    expect(await data.db.customers.count()).toBe(0);
  });

  it('adds a new customer without a limit with no approval', async () => {
    const { data, waiter } = await team({ creditSale: true });
    await show(data, waiter.id);
    await userEvent.click(await screen.findByRole('button', { name: 'Yeni müşteri' }));
    const form = await screen.findByRole('dialog', { name: 'Yeni müşteri' });
    await userEvent.type(within(form).getByLabelText('Ad'), 'Veli');
    await userEvent.click(within(form).getByRole('button', { name: 'Kaydet' }));
    await waitFor(async () => expect(await data.db.customers.count()).toBe(1));
    expect(screen.queryByRole('dialog', { name: 'Yetkili onayı' })).toBeNull();
  });
});
